// Bun bundles these imports (in the SPA and in the server, `with { type: "file" }`); the value is the asset's URL/path.
declare module "*.png" {
  const path: string;
  export default path;
}
declare module "*.webp" {
  const path: string;
  export default path;
}
declare module "*.svg" {
  const path: string;
  export default path;
}
