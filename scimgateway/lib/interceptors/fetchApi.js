const { requests } = require("./requests");

function formatAuth(auth) {
  switch (auth.type) {
    case "bearer":
      return "Bearer " + auth.token;
    case "basic":
      return "Basic " + btoa(`${auth.username}:${auth.password}`);
    default:
      return "";
  }
}

// replacing {{text}} variables in string to body values
function formatURL(body, url) {
  const replaceKey = (match, key) => {
    // Verify if key exists in body
    if (body[key]) {
      return body[key];
    }

    // throw an error if key does not exist
    throw new Error(`Missing required field ${key} in body`);
  };

  return url.replace(/{{(.*?)}}/g, replaceKey);
}

async function fetchApi(ctx, next) {
  const results = await Promise.all(
    requests.map(async (request) => {
      if (ctx.request.header.host.split(":")[1] !== request.port) {
        return true;
      }

      try {
        let formattedURL = formatURL(ctx.request.body, request.url);
        const response = await fetch(formattedURL, {
          method: request.method,
          headers: { Authorization: formatAuth(request.auth) },
        });
        const jsonData = await response.json();

        let responseAttrs = {};
        request.mapping.forEach((item) => {
          responseAttrs[item.mapTo] = jsonData[item.name];
        });

        ctx.request.body = { ...ctx.request.body, ...responseAttrs };
        return true;
      } catch (error) {
        ctx.status = 400;
        ctx.body = {
          message: "Error while fetching interceptor api",
          url: request.url,
          error: error.message,
        };
        return ctx;
      }
    })
  );

  return results.every((item) => item === true);
}

module.exports = { fetchApi };
