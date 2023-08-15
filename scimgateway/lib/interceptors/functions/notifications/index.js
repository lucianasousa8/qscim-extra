const { notifications } = require("../../data/notifications");
const { formatAuth } = require("../../utils/formatAuth");
const { formatURL } = require("../../utils/formatURL");
const { getCacheInfo } = require("../../utils/getCacheInfo");

function verifyAllowedRequests(allowedRequests, method, path) {
  const results = allowedRequests.map(
    (item) => item.method === method && item.path === path
  );

  return results.some((item) => item === true);
}

async function fetchNotification(ctx, type, caches, scimData) {
  const results = await Promise.all(
    notifications
      .filter(
        (request) =>
          ctx.request.header.host.split(":")[1] === request.port &&
          request.type === type &&
          verifyAllowedRequests(
            request.allowed_requests,
            ctx.request.method,
            ctx.request.url.split("/")[1].toLowerCase()
          )
      )
      .map(async (request) => {
        const hasScimData = scimData && scimData.length;
        let formattedBody = hasScimData ? scimData[0] : ctx.request.body;

        if (ctx.request.url.split("/").length > 2) {
          formattedBody.userName =
            formattedBody?.userName || ctx.request.url.split("/").at(-1);
        }

        try {
          let formattedURL = formatURL(
            ctx.request.body,
            request.useURL
              ? `${request.url}${ctx.request.url}`
              : `${request.url}`
          );

          let formattedAuth = await getCacheInfo(request.auth, caches);

          const response = await fetch(formattedURL, {
            method: request.method,
            headers: {
              Authorization: formatAuth(formattedAuth),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              info: {
                url: ctx.request.url,
                method: ctx.request.method,
                type: request.type,
              },
              data: request.payload === "response" ? ctx.body : formattedBody,
            }),
          });

          if (![200, 201].includes(response.status)) {
            throw new Error(`Request returned status ${response.status}`);
          }

          return true;
        } catch (error) {
          console.log(error);
          ctx.status = 400;
          ctx.body = {
            message: "Error while fetching notification api",
            type: `Notification type: ${request.type}`,
            details:
              request.type === "before"
                ? "SCIM request not fetched yet"
                : "SCIM request already fetched",
            url: formatURL(
              ctx.request.body,
              `${request.url}${ctx.request.url}`
            ),
            error: error.message,
          };
          return ctx;
        }
      })
  );

  return results.every((item) => item === true);
}

module.exports = { fetchNotification };
