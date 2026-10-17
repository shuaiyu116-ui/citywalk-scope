// Offline browser/HTTP fixture: .env credentials and all external fetches blocked.
require('./w01-offline.cjs');
const modelFetch = global.fetch;
function encode(points) {
  let lat = 0, lng = 0, shape = '';
  const number = delta => {
    let v = delta < 0 ? ~(delta << 1) : delta << 1, text = '';
    while (v >= 32) { text += String.fromCharCode((32 | (v & 31)) + 63); v >>>= 5; }
    return text + String.fromCharCode(v + 63);
  };
  for (const point of points) {
    const a = Math.round(point.lat * 1e6), b = Math.round(point.lon * 1e6);
    shape += number(a - lat) + number(b - lng); lat = a; lng = b;
  }
  return shape;
}
global.fetch = async (url, options) => {
  if (String(url).includes('valhalla') || String(url).includes('router.invalid')) {
    const body = JSON.parse(options.body);
    if (body.costing === 'bicycle') throw new Error('Offline cycling outage');
    const [a, b] = [body.locations[0], body.locations.at(-1)];
    const length = Math.max(.1, Math.hypot(a.lat - b.lat, (a.lon - b.lon) * .85) * 111 * 1.3);
    return new Response(JSON.stringify({ trip: { summary: { length, time: length / (body.costing === 'pedestrian' ? 4.5 : 25) * 3600 }, legs: [{ shape: encode(body.locations) }] } }));
  }
  return modelFetch(url, options);
};
module.exports = { encode };
