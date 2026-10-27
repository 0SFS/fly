/**
 * The fleet this simulator flies. Importing this module registers the built-in
 * aircraft, engine and payload mods from their manifests before anything reads
 * the catalogs. There is no extra network fetch: the manifests are bundled.
 */
import "../mods/installBuiltinMods";
