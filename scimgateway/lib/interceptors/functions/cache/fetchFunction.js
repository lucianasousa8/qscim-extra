const { formatAuth } = require("../../utils/formatAuth");

async function createCacheFetchFunction(request) {
  try {
    let formattedURL = request.url;
    console.log("URL:", request.url);

    let headers = {
      Authorization: formatAuth(request.auth),
      ...request.headers,
    };

    if (request.body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(formattedURL, {
      method: request.method,
      headers: headers,
      body: request.body ? JSON.stringify(request.body) : undefined,
    });

    if (![200, 201].includes(response.status)) {
      console.log(await response.json());
      throw new Error(`Request returned status ${response.status}`);
    }

    const jsonData = await response.json();

    let responseAttrs = {};
    request.mapping.forEach((item) => {
      responseAttrs[item.mapTo] = jsonData[item.name];
    });

    return responseAttrs;
  } catch (error) {
    console.log("Error caching information:", error.message);
    return {};
  }
}

module.exports = { createCacheFetchFunction };
