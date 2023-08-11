function getCacheValue(str) {
    const regex = /{{cache\.([a-zA-Z0-9._]+)}}/;
    const match = str.match(regex);
    return match ? match[1] : null;
  }
  
  async function getCacheInfo(originalObj, caches) {
    for (const field in originalObj) {
      const value = getCacheValue(originalObj[field]);
      if (value !== null) {
        const splittedValue = value.split(".");
        const result = await caches[splittedValue[0]]?.getData();
        originalObj[field] = result[splittedValue.slice(1).join(".")];
      }
    }
    return originalObj;
  }
  
  module.exports = { getCacheInfo };
  