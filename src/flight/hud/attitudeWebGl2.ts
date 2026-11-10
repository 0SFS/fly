import type { FrameProfiler } from "foss-earth/perf";
import { attitudeArtScale, labelFontPx, type AttitudeScene } from "./attitudeIndicator";
import { attitudeFrameCorner, type AttitudeStick } from "./attitudeCanvas";
import {
  ATTITUDE_MAX_SPRITES, ATTITUDE_SPRITE_FLOATS, letterAttitudeAtlas, writeAttitudeSprites,
} from "./attitudeSprites";
import { attitudeWebGl2Shaders } from "./attitudeWebGl2Shader";

export interface WebGl2Attitude {
  render(scene: AttitudeScene, stick: AttitudeStick, pixelRatio: number): void;
  destroy(): void;
}

export interface WebGl2AttitudeOptions {
  onContextLost?(): void;
  profiler?: FrameProfiler | null;
  section?: string;
}

/** Queries are polled on later draws, never waited for on the rendering thread. */
function passTimer(gl: WebGL2RenderingContext, profiler: FrameProfiler | null, section: string) {
  const extension = profiler ? gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
    TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number;
  } | null : null;
  if (!extension || !profiler) return null;
  const queries = new Set<WebGLQuery>();
  const idle: WebGLQuery[] = [];
  const pending: WebGLQuery[] = [];
  return {
    begin() {
      if (!profiler.enabled && pending.length === 0) return null;
      const disjoint = Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT));
      while (pending.length) {
        const query = pending[0]!;
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        if (!disjoint) profiler.addDuration(section, Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
        idle.push(query);
      }
      if (disjoint) {
        // Every outstanding result could cover the discontinuity, even if it
        // becomes available only after the driver's disjoint flag clears.
        for (const query of pending.splice(0)) { gl.deleteQuery(query); queries.delete(query); }
        return null;
      }
      if (!profiler.enabled) return null;
      let query = idle.pop();
      if (!query && queries.size < 3) {
        query = gl.createQuery() ?? undefined;
        if (query) queries.add(query);
      }
      if (query) gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      return query ?? null;
    },
    end(query: WebGLQuery) { gl.endQuery(extension.TIME_ELAPSED_EXT); pending.push(query); },
    destroy() { for (const query of queries) gl.deleteQuery(query); queries.clear(); pending.length = idle.length = 0; },
  };
}

/** Owns only this indicator's context; a failed setup can be replaced with a fresh 2D canvas. */
export function createWebGl2Attitude(canvas: HTMLCanvasElement, {
  onContextLost, profiler = null, section = "gpu/attitude indicator",
}: WebGl2AttitudeOptions = {}): WebGl2Attitude | null {
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
  if (!gl) return null;
  const programs = new Set<WebGLProgram>();
  const buffers = new Set<WebGLBuffer>();
  const arrays = new Set<WebGLVertexArrayObject>();
  const textures = new Set<WebGLTexture>();
  let lost = false, disposed = false;
  let timer: ReturnType<typeof passTimer> = null;
  const contextLost = (event: Event): void => {
    event.preventDefault();
    lost = true;
    if (!disposed) onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", contextLost);
  const release = (): void => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener("webglcontextlost", contextLost);
    timer?.destroy();
    for (const texture of textures) gl.deleteTexture(texture);
    for (const array of arrays) gl.deleteVertexArray(array);
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    for (const program of programs) gl.deleteProgram(program);
    textures.clear(); arrays.clear(); buffers.clear(); programs.clear();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  const shader = (kind: number, source: string): WebGLShader => {
    const result = gl.createShader(kind);
    if (!result) throw new Error("WebGL2 could not allocate an attitude shader.");
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(result);
      gl.deleteShader(result);
      throw new Error(`Attitude shader failed: ${message}`);
    }
    return result;
  };
  const program = (vertex: string, fragment: string): WebGLProgram => {
    const compiled: WebGLShader[] = [];
    try {
      compiled.push(shader(gl.VERTEX_SHADER, vertex));
      compiled.push(shader(gl.FRAGMENT_SHADER, fragment));
      const result = gl.createProgram();
      if (!result) throw new Error("WebGL2 could not allocate an attitude program.");
      programs.add(result);
      for (const part of compiled) gl.attachShader(result, part);
      gl.linkProgram(result);
      if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(`Attitude program failed: ${gl.getProgramInfoLog(result)}`);
      const frame = gl.getUniformBlockIndex(result, "Frame");
      if (frame === gl.INVALID_INDEX) throw new Error("Attitude program has no frame uniforms.");
      gl.uniformBlockBinding(result, frame, 0);
      return result;
    } finally { for (const part of compiled) gl.deleteShader(part); }
  };
  const buffer = (): WebGLBuffer => {
    const value = gl.createBuffer();
    if (!value) throw new Error("WebGL2 could not allocate attitude storage.");
    buffers.add(value);
    return value;
  };
  const array = (): WebGLVertexArrayObject => {
    const value = gl.createVertexArray();
    if (!value) throw new Error("WebGL2 could not allocate attitude attributes.");
    arrays.add(value);
    return value;
  };
  try {
    timer = passTimer(gl, profiler, section);
    const source = attitudeWebGl2Shaders();
    const ball = program(source.ballVertex, source.ballFragment);
    const sprites = program(source.spriteVertex, source.spriteFragment);
    const frameBuffer = buffer(), spriteBuffer = buffer();
    const frameData = new Float32Array(20);
    const spriteData = new Float32Array(ATTITUDE_MAX_SPRITES * ATTITUDE_SPRITE_FLOATS);
    gl.bindBuffer(gl.UNIFORM_BUFFER, frameBuffer);
    gl.bufferData(gl.UNIFORM_BUFFER, frameData.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, frameBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, spriteData.byteLength, gl.DYNAMIC_DRAW);
    const ballArray = array(), spriteArray = array();
    gl.bindVertexArray(spriteArray);
    for (const [location, components, offset] of [[0, 2, 0], [1, 2, 8], [2, 4, 16], [3, 2, 32], [4, 1, 40]]) {
      gl.enableVertexAttribArray(location!);
      gl.vertexAttribPointer(location!, components!, gl.FLOAT, false, ATTITUDE_SPRITE_FLOATS * 4, offset!);
      gl.vertexAttribDivisor(location!, 1);
    }
    gl.useProgram(sprites);
    gl.uniform1i(gl.getUniformLocation(sprites, "atlas"), 0);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL2 could not prepare the attitude buffers.");
    let atlas: (ReturnType<typeof letterAttitudeAtlas> & { key: string; texture: WebGLTexture }) | null = null;
    const ensureAtlas = (fontPx: number, scale: number, pixelRatio: number) => {
      const key = `${fontPx}:${scale}:${pixelRatio}`;
      if (atlas?.key === key) return atlas;
      const lettered = letterAttitudeAtlas(canvas.ownerDocument, fontPx, scale, pixelRatio);
      const texture = gl.createTexture();
      if (!texture) throw new Error("WebGL2 could not allocate the attitude lettering.");
      textures.add(texture);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lettered.canvas);
      if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL2 could not upload the attitude lettering.");
      if (atlas) { gl.deleteTexture(atlas.texture); textures.delete(atlas.texture); }
      atlas = { ...lettered, key, texture };
      return atlas;
    };
    return {
      render(scene, stick, pixelRatio) {
        if (disposed || lost || gl.isContextLost()) return;
        const { projection, view: m } = scene;
        const lettering = ensureAtlas(labelFontPx(projection), attitudeArtScale(projection), pixelRatio);
        const count = writeAttitudeSprites(spriteData, lettering.entries, scene, stick, pixelRatio);
        frameData.set([m[0]!, m[1]!, m[2]!, 0, m[3]!, m[4]!, m[5]!, 0, m[6]!, m[7]!, m[8]!, 0]);
        frameData.set([projection.size, pixelRatio, projection.size / 2, projection.half], 12);
        frameData.set([projection.a, projection.b, attitudeArtScale(projection), attitudeFrameCorner(projection)], 16);
        gl.bindBuffer(gl.UNIFORM_BUFFER, frameBuffer);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, frameData);
        gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer);
        if (count > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, spriteData, 0, count * ATTITUDE_SPRITE_FLOATS);
        gl.viewport(0, 0, canvas.width, canvas.height);
        const query = timer?.begin();
        try {
          gl.disable(gl.BLEND);
          gl.useProgram(ball);
          gl.bindVertexArray(ballArray);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          if (count > 0) {
            gl.enable(gl.BLEND);
            gl.useProgram(sprites);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, lettering.texture);
            gl.bindVertexArray(spriteArray);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
          }
        } finally { if (query) timer?.end(query); }
      },
      destroy: release,
    };
  } catch (error) { release(); throw error; }
}
