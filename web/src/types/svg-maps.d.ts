// @svg-maps/world's index.d.ts references `svg-maps__common` which isn't
// installed. Declare the module so tsc resolves the JS import loosely;
// src/lib/worldMap.ts provides the real typing we use.
declare module "@svg-maps/world/index.js" {
  const map: {
    label: string;
    viewBox: string;
    locations: { id: string; name: string; path: string }[];
  };
  export default map;
}
