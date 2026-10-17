import { wgs84ToGcj02 } from './coordinates.mjs';
export function positionWgs84(point, system='wgs84') {
  if(!point || typeof point.lat!=='number' || typeof point.lng!=='number' || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat)>90 || Math.abs(point.lng)>180) throw Error('位置坐标无效');
  if(system==='wgs84') return {lat:point.lat,lng:point.lng};
  if(system!=='gcj02') throw Error('请选择坐标系');
  let result={...point};
  for(let i=0;i<4;i++){const [lat,lng]=wgs84ToGcj02([result.lat,result.lng]);result={lat:result.lat+point.lat-lat,lng:result.lng+point.lng-lng};}
  return result;
}
export function amapLink(to, from=null, mode='walking') {
  const encode=p=>{const q=positionWgs84(p.location),[lat,lng]=wgs84ToGcj02([q.lat,q.lng]);return `${lng.toFixed(6)},${lat.toFixed(6)},${String(p.name || '选定位置').replace(/,/g,' ')}`;};
  const url=new URL('https://uri.amap.com/navigation');
  url.searchParams.set('to',encode(to));
  if(from) url.searchParams.set('from',encode(from));
  url.searchParams.set('mode',({walking:'walk',cycling:'ride',driving:'car',taxi:'car',transit:'bus'})[mode] || 'walk');
  url.searchParams.set('src','CitywalkScope');url.searchParams.set('coordinate','gaode');url.searchParams.set('callnative','0');
  return url.href;
}
