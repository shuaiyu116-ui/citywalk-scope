export function wgs84ToGcj02([lat, lng]) {
  const pi = Math.PI;
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  const outOfChina = lat < 0.8293 || lat > 55.8271 || lng < 72.004 || lng > 137.8347;
  if (outOfChina) return [lat, lng];
  const transformLat = (x, y) => {
    let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    value += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
    value += (20 * Math.sin(y * pi) + 40 * Math.sin(y / 3 * pi)) * 2 / 3;
    value += (160 * Math.sin(y / 12 * pi) + 320 * Math.sin(y * pi / 30)) * 2 / 3;
    return value;
  };
  const transformLng = (x, y) => {
    let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    value += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
    value += (20 * Math.sin(x * pi) + 40 * Math.sin(x / 3 * pi)) * 2 / 3;
    value += (150 * Math.sin(x / 12 * pi) + 300 * Math.sin(x / 30 * pi)) * 2 / 3;
    return value;
  };
  const dLat = transformLat(lng - 105, lat - 35);
  const dLng = transformLng(lng - 105, lat - 35);
  const radLat = lat / 180 * pi;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return [lat + (dLat * 180) / ((a * (1 - ee)) / (magic * sqrtMagic) * pi), lng + (dLng * 180) / (a / sqrtMagic * Math.cos(radLat) * pi)];
}


