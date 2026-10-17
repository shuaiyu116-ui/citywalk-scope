'use strict';
const {normalizeTripInput}=require('./itinerary');

const QUESTION_FIELDS=['city','dayCount','startDate','companions','hotel','hotelBudget','hotelArea','hotelRooms','hotelDates'];
const clean=(value,max)=>typeof value==='string'?value.replace(/\bsk-[a-zA-Z0-9_-]+/g,'[已隐藏密钥]').replace(/Bearer\s+\S+/gi,'[已隐藏凭据]').slice(0,max).trim():'';

// These are user preferences, never hotel availability, quoted rates or bookings.
// Keep them separate from the itinerary's fixed travel-condition contract.
function normalizeHotelPreferences(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const result={};
  if(typeof value.requested==='boolean')result.requested=value.requested;
  for(const key of ['checkIn','checkOut']){
    if(!value[key])continue;
    try{result[key]=normalizeTripInput({startDate:value[key]}).startDate;}catch{}
  }
  for(const [key,min,max] of [['budgetMax',0,100000],['roomCount',1,8],['adultCount',1,16],['childCount',0,8]]){
    const raw=value[key];
    if(raw===undefined||raw===null||raw==='')continue;
    const number=typeof raw==='number'||typeof raw==='string'&&/^\d+(?:\.\d+)?$/.test(raw)?Number(raw):NaN;
    if(Number.isFinite(number)&&number>=min&&number<=max&&(key==='budgetMax'||Number.isInteger(number)))result[key]=number;
  }
  for(const [key,max] of [['area',100],['requirements',240]])if(clean(value[key],max))result[key]=clean(value[key],max);
  return result;
}

function skipsPreflight(prompt){
  return /跳过|不(?:用|要|必)(?:再)?(?:问|提问|追问)|直接(?:生成|安排|规划|开始)|按(?:默认|常规|一般)(?:安排|规划|生成)?|你(?:来)?(?:决定|定|安排)|随(?:便|你)|无(?:特殊)?(?:要求|偏好)/.test(String(prompt||''));
}

function hotelPreferenceFromText(prompt){
  const text=String(prompt||'');
  if(/(?:不(?:用|要|需|想|住)|无需|别)(?:要)?(?:推荐|选择|安排|查询|查|找)?(?:住宿|酒店)|(?:酒店|住宿)(?:我)?(?:已经|已)?(?:订好|安排好|不用|不需要)/.test(text))return {requested:false};
  if(/(?:推荐|选择|安排|查询|查|找|住|需要).{0,8}(?:酒店|住宿)|(?:酒店|住宿).{0,8}(?:推荐|选择|安排|查询|预算)/.test(text))return {requested:true};
  return {};
}

function hotelPreferencesFromRoute(route){
  const hotels=route?.hotels;
  if(!hotels)return {};
  const request=hotels.request||{};
  return normalizeHotelPreferences({
    ...request,requested:hotels.status==='not-requested'?false:true,
    checkIn:request.checkIn||request.checkInDate,checkOut:request.checkOut||request.checkOutDate,
    budgetMax:request.budgetMax??request.maxPrice,area:request.area||request.landmarkName
  });
}

function requestsHotelChange(prompt){
  const text=String(prompt||'');
  if(/^(?:请)?(?:为什么|为何|介绍|解释|说明|查看|看看)/.test(text.trim())&&!/改成|改为|重新|换|取消|删除|去掉|不(?:用|需|要|住)|推荐一家|找一家/.test(text))return false;
  if(hotelPreferenceFromText(text).requested!==undefined)return true;
  return /(?:推荐|找|选择|查询|搜|换|安排|增加|取消|删除|去掉).{0,12}(?:酒店|住宿)|(?:酒店|住宿).{0,12}(?:推荐|找|选择|查询|搜|换|安排|增加|取消|删除|去掉)|(?:酒店|住宿|每晚|房间).{0,12}(?:改成|改为|调整为)/.test(text);
}

function questionField(plan){
  const field=plan.questionField||plan.field;
  if(QUESTION_FIELDS.includes(field))return field;
  const question=String(plan.question||'');
  if(/酒店|住宿|入住|退房|每晚|房间|几间房/.test(question)){
    if(/预算|价位|每晚/.test(question))return 'hotelBudget';
    if(/入住|退房|日期/.test(question))return 'hotelDates';
    if(/房间|几间|人数|几人/.test(question))return 'hotelRooms';
    if(/区域|位置|附近|住哪/.test(question))return 'hotelArea';
    return 'hotel';
  }
  if(/几天|多少天|天数/.test(question))return 'dayCount';
  if(/日期|哪天|什么时候/.test(question))return 'startDate';
  if(/同行|几人|人数|孩子|老人|亲子/.test(question))return 'companions';
  if(/城市|去哪|哪里|哪儿/.test(question))return 'city';
  return null;
}

function needsPreflightField(field,{conditions,hotelPreferences,request}){
  if(field==='dayCount')return conditions.dayCount===undefined;
  if(field==='startDate')return !conditions.startDate&&!hotelPreferences.checkIn;
  if(field==='companions')return conditions.companions===undefined&&hotelPreferences.adultCount===undefined&&hotelPreferences.childCount===undefined;
  if(!field?.startsWith('hotel')||hotelPreferences.requested===false)return false;
  const hotelsRelevant=hotelPreferences.requested===true||conditions.dayCount>1||/酒店|住宿/.test(request);
  if(!hotelsRelevant)return false;
  if(field==='hotelBudget')return hotelPreferences.budgetMax===undefined;
  if(field==='hotelArea')return !hotelPreferences.area;
  if(field==='hotelRooms')return hotelPreferences.roomCount===undefined||hotelPreferences.adultCount===undefined;
  if(field==='hotelDates')return !hotelPreferences.checkIn&&!conditions.startDate||!hotelPreferences.checkOut&&conditions.dayCount===undefined;
  return hotelPreferences.requested===undefined;
}

module.exports={QUESTION_FIELDS,normalizeHotelPreferences,skipsPreflight,hotelPreferenceFromText,hotelPreferencesFromRoute,requestsHotelChange,questionField,needsPreflightField};
