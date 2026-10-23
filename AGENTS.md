# Agent instructions

This repository is the 0SFS flight app. It composes the sibling aircraft, engine, and feature repositories and serves `/fly/` and `/rc/`.

Follow the shared rules for every 0SFS repository in
[0SFS/.github/AGENTS.md](https://github.com/0SFS/.github/blob/main/AGENTS.md)
(in a local checkout of the organization: `../.github/AGENTS.md`).

To serve the app to a phone, run `npm run dev`. It prints a network URL and QR code and serves HTTPS with a self-signed certificate, and the phone accepts the warning once. A plain `http://` network address is not a secure page and has no WebGPU or shared memory, so a test there says nothing about either. [README.md](README.md) has the details.

For temporary autonomous checks, use `npm run llm-dev` (HTTPS and network
links remain; no environment key is supplied). Stop every server and child process you start before returning,
unless the user explicitly asks you to keep it running; leave others' servers
alone. For user testing, give them the command below to run in their own terminal:

```sh
cd ~/gh/0sfs/fly && npm run dev
```
