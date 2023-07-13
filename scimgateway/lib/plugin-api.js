// =================================================================================
// File:    plugin-api.js
//
// Author:  Samuel Vianna
//
// Purpose: communicate with a REST API that uses SCIM Protocol
//
// =================================================================================

"use strict";

const http = require("http");
const https = require("https");
const HttpsProxyAgent = require("https-proxy-agent");
const URL = require("url").URL;
const querystring = require("querystring");

// mandatory plugin initialization - start
const path = require("path");
let ScimGateway = require("./scimgateway");
const scimgateway = new ScimGateway();
const pluginName = path.basename(__filename, ".js");
const configDir = path.join(__dirname, "..", "config");
const configFile = path.join(`${configDir}`, `${pluginName}.json`);
let config = require(configFile).endpoint;
config = scimgateway.processExtConfig(pluginName, config); // add any external config process.env and process.file
scimgateway.authPassThroughAllowed = false; // true enables auth passThrough (no scimgateway authentication). scimgateway instead includes ctx (ctx.request.header) in plugin methods. Note, requires plugin-logic for handling/passing ctx.request.header.authorization to be used in endpoint communication
// mandatory plugin initialization - end

const _serviceClient = {};

// =================================================
// createUser
// =================================================
scimgateway.createUser = async (baseEntity, userObj, ctx) => {
  const action = "createUser";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" userObj=${JSON.stringify(
      userObj
    )}`
  );

  try {
    return await new Promise((resolve, reject) => {
      const body = scimgateway.endpointMapper(
        "outbound",
        userObj,
        config.map.user
      )[0];

      async function main() {
        const method = "POST";
        const path = config.entity[baseEntity].userRoute || "/users";
        const response = await doRequest(baseEntity, method, path, body, ctx);
        return response.body;
      }

      main()
        .then(async () => {
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreUsers API client connect error: ${err.message}`
          );
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// modifyUser
// =================================================
scimgateway.modifyUser = async (baseEntity, id, attrObj, ctx) => {
  const action = "modifyUser";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" id=${id} attrObj=${JSON.stringify(
      attrObj
    )}`
  );

  try {
    return await new Promise((resolve, reject) => {
      const body = scimgateway.endpointMapper(
        "outbound",
        attrObj,
        config.map.user
      )[0];

      async function main() {
        const method = "PUT";
        const basePath = config.entity[baseEntity].userRoute || "/users";
        const path = `${basePath}/${id}`;
        const response = await doRequest(baseEntity, method, path, body, ctx);
        return response.body;
      }

      main()
        .then(async () => {
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `modifyUser API client connect error: ${err.message}`
          );
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// getUsers
// =================================================
scimgateway.getUsers = async (baseEntity, getObj, attributes, ctx) => {
  const action = "getUsers";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" getObj=${
      getObj ? JSON.stringify(getObj) : ""
    } attributes=${attributes}`
  );

  let filter;

  // mandatory if-else logic - start
  if (getObj.operator) {
    if (
      getObj.operator === "eq" &&
      ["id", "userName", "externalId"].includes(getObj.attribute)
    ) {
      // mandatory - unique filtering - single unique user to be returned - correspond to getUser() in versions < 4.x.x
      filter = { id: getObj.value };
    } else if (getObj.operator === "eq" && getObj.attribute === "group.value") {
      // optional - only used when groups are member of users, not default behavior - correspond to getGroupUsers() in versions < 4.x.x
      throw new Error(
        `${action} error: not supporting groups member of user filtering: ${getObj.rawFilter}`
      );
    } else {
      // optional - simpel filtering
      throw new Error(
        `${action} error: not supporting simpel filtering: ${getObj.rawFilter}`
      );
    }
  } else if (getObj.rawFilter) {
    // optional - advanced filtering having and/or/not - use getObj.rawFilter
    throw new Error(
      `${action} not error: supporting advanced filtering: ${getObj.rawFilter}`
    );
  } else {
    // mandatory - no filtering (!getObj.operator && !getObj.rawFilter) - all users to be returned - correspond to exploreUsers() in versions < 4.x.x
    filter = {};
  }
  // mandatory if-else logic - end

  if (!filter)
    throw new Error(
      `${action} error: mandatory if-else logic not fully implemented`
    );

  try {
    return await new Promise((resolve, reject) => {
      const ret = {
        // itemsPerPage will be set by scimgateway
        Resources: [],
        totalResults: null,
      };

      async function main() {
        async function getRequest() {
          const basePath = config.entity[baseEntity].userRoute || "/users";
          const method = "GET";
          const body = null;
          if (filter.id) {
            const path = `/${basePath}/${filter.id}`;
            const response = await doRequest(
              baseEntity,
              method,
              path,
              body,
              ctx
            );
            return [response.body];
          } else {
            const path = basePath;
            const response = await doRequest(
              baseEntity,
              method,
              path,
              body,
              ctx
            );
            return response.body;
          }
        }

        let rows = await getRequest();
        for (const row in rows) {
          const scimUser = scimgateway.endpointMapper(
            "inbound",
            rows[row],
            config.map.user
          )[0];
          ret.Resources.push(scimUser);
        }
      }

      main()
        .then(async () => {
          resolve(ret); // all explored users
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreUsers API client connect error: ${err.message}`
          );
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// deleteUser
// =================================================
scimgateway.deleteUser = async (baseEntity, id, ctx) => {
  const action = "deleteUser";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" id=${id}`
  );

  try {
    return await new Promise((resolve, reject) => {
      async function main() {
        const method = "DELETE";
        const basePath = config.entity[baseEntity].userRoute || "/users";
        const path = `${basePath}/${id}`;
        const body = null;
        const response = await doRequest(baseEntity, method, path, body, ctx);
        return response.body;
      }

      main()
        .then(async () => {
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `deleteUser API client connect error: ${err.message}`
          );
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// createGroup
// =================================================
scimgateway.createGroup = async (baseEntity, groupObj, ctx) => {
  const action = "createGroup";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" groupObj=${JSON.stringify(
      groupObj
    )}`
  );

  try {
    return await new Promise((resolve, reject) => {
      const body = scimgateway.endpointMapper(
        "outbound",
        groupObj,
        config.map.group
      )[0];

      async function main() {
        const method = "POST";
        const path = config.entity[baseEntity].groupRoute || "/groups";
        const response = await doRequest(baseEntity, method, path, body, ctx);
        return response.body;
      }

      main()
        .then(async () => {
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreUsers API client connect error: ${err.message}`
          );
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// modifyGroup
// =================================================
scimgateway.modifyGroup = async (baseEntity, id, attrObj, ctx) => {
  const action = "modifyGroup";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" id=${id} attrObj=${JSON.stringify(
      attrObj
    )}`
  );

  try {
    return await new Promise((resolve, reject) => {
      const body = scimgateway.endpointMapper(
        "outbound",
        attrObj,
        config.map.group
      )[0];

      async function main() {
        const method = "PUT";
        const basePath = config.entity[baseEntity].groupRoute || "/groups";
        const path = `${basePath}/${id}`;
        const response = await doRequest(baseEntity, method, path, body, ctx);
        return response.body;
      }

      main()
        .then(async () => {
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `modifyUser API client connect error: ${err.message}`
          );
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// getGroups
// =================================================
scimgateway.getGroups = async (baseEntity, getObj, attributes, ctx) => {
  const action = "getGroups";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" getObj=${
      getObj ? JSON.stringify(getObj) : ""
    } attributes=${attributes}`
  );

  let filter;

  // mandatory if-else logic - start
  if (getObj.operator) {
    if (
      getObj.operator === "eq" &&
      ["id", "userName", "externalId"].includes(getObj.attribute)
    ) {
      // mandatory - unique filtering - single unique user to be returned - correspond to getUser() in versions < 4.x.x
      filter = { id: getObj.value };
    } else if (getObj.operator === "eq" && getObj.attribute === "group.value") {
      // optional - only used when groups are member of users, not default behavior - correspond to getGroupUsers() in versions < 4.x.x
      throw new Error(
        `${action} error: not supporting groups member of user filtering: ${getObj.rawFilter}`
      );
    } else {
      // optional - simpel filtering
      throw new Error(
        `${action} error: not supporting simpel filtering: ${getObj.rawFilter}`
      );
    }
  } else if (getObj.rawFilter) {
    // optional - advanced filtering having and/or/not - use getObj.rawFilter
    throw new Error(
      `${action} not error: supporting advanced filtering: ${getObj.rawFilter}`
    );
  } else {
    // mandatory - no filtering (!getObj.operator && !getObj.rawFilter) - all users to be returned - correspond to exploreUsers() in versions < 4.x.x
    filter = {};
  }
  // mandatory if-else logic - end

  if (!filter)
    throw new Error(
      `${action} error: mandatory if-else logic not fully implemented`
    );

  try {
    return await new Promise((resolve, reject) => {
      const ret = {
        // itemsPerPage will be set by scimgateway
        Resources: [],
        totalResults: null,
      };

      async function main() {
        async function getRequest() {
          const method = "GET";
          const basePath = config.entity[baseEntity].groupRoute || "/groups";
          const body = null;
          if (filter.id) {
            const path = `${basePath}/${filter.id}`;
            const response = await doRequest(
              baseEntity,
              method,
              path,
              body,
              ctx
            );
            return [response.body];
          } else {
            const path = basePath;
            const response = await doRequest(
              baseEntity,
              method,
              path,
              body,
              ctx
            );
            return response.body;
          }
        }

        let rows = await getRequest();
        for (const row in rows) {
          const scimGroup = scimgateway.endpointMapper(
            "inbound",
            rows[row],
            config.map.group
          )[0];
          ret.Resources.push(scimGroup);
        }
      }

      main()
        .then(async () => {
          resolve(ret); // all explored users
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreUsers API client connect error: ${err.message}`
          );
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// deleteGroup
// =================================================
scimgateway.deleteGroup = async (baseEntity, id, ctx) => {
  const action = "deleteGroup";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" id=${id}`
  );

  try {
    return await new Promise((resolve, reject) => {
      async function main() {
        const method = "DELETE";
        const basePath = config.entity[baseEntity].groupRoute || "/groups";
        const path = `/${basePath}/${id}`;
        const body = null;
        const response = await doRequest(baseEntity, method, path, body, ctx);
        return response.body;
      }

      main()
        .then(async () => {
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `deleteUser API client connect error: ${err.message}`
          );
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// helpers
// =================================================

const getClientIdentifier = (ctx) => {
  if (!ctx?.request?.header?.authorization) return undefined;
  const [user, secret] = getCtxAuth(ctx);
  return `${encodeURIComponent(user)}_${encodeURIComponent(secret)}`; // user_password or undefined_password
};

//
// getCtxAuth returns username/secret from ctx header when using Auth PassThrough
//
const getCtxAuth = (ctx) => {
  // eslint-disable-line
  if (!ctx?.request?.header?.authorization) return [];
  const [authType, authToken] = (ctx.request.header.authorization || "").split(
    " "
  ); // [0] = 'Basic' or 'Bearer'
  let username, password;
  if (authType === "Basic")
    [username, password] = (
      Buffer.from(authToken, "base64").toString() || ""
    ).split(":");
  if (username) return [username, password]; // basic auth
  else return [undefined, authToken]; // bearer auth
};

//
// getServiceClient - returns options needed for connection parameters
//
//   path = e.g. "/xxx/yyy", then using host/port/protocol based on config baseUrls[0]
//          auth automatically added and failover according to baseUrls array
//
//   path = url e.g. "http(s)://<host>:<port>/xxx/yyy", then using the url host/port/protocol
//          opt (options) may be needed e.g {auth: {username: "username", password: "password"} }
//
const getServiceClient = async (baseEntity, method, path, opt, ctx) => {
  const action = "getServiceClient";

  let urlObj;
  if (!path) path = "";
  try {
    urlObj = new URL(path);
  } catch (err) {
    //
    // path (no url) - default approach and client will be cached based on config
    //
    const clientIdentifier = getClientIdentifier(ctx);
    if (
      _serviceClient[baseEntity] &&
      _serviceClient[baseEntity][clientIdentifier]
    ) {
      // serviceClient already exist
      scimgateway.logger.debug(
        `${pluginName}[${baseEntity}] ${action}: Using existing client`
      );
    } else {
      scimgateway.logger.debug(
        `${pluginName}[${baseEntity}] ${action}: Client have to be created`
      );
      let client = null;
      if (config.entity && config.entity[baseEntity])
        client = config.entity[baseEntity];
      if (!client) {
        throw new Error(
          `Base URL have baseEntity=${baseEntity}, and configuration file ${pluginName}.json is missing required baseEntity configuration for ${baseEntity}`
        );
      }

      urlObj = new URL(config.entity[baseEntity].baseUrls[0]);
      const param = {
        baseUrl: config.entity[baseEntity].baseUrls[0],
        options: {
          json: true, // json-object response instead of string
          headers: {
            "Content-Type": "application/json",
            // Auth PassThrough or configuration, using ctx "AS-IS" header for PassThrough. For more advanced logic use getCtxAuth(ctx) - see examples in other plugins
            Authorization: ctx?.request?.header?.authorization
              ? ctx.request.header.authorization
              : "Basic " +
                Buffer.from(
                  `${
                    config.entity[baseEntity].username
                  }:${scimgateway.getPassword(
                    `endpoint.entity.${baseEntity}.password`,
                    configFile
                  )}`
                ).toString("base64"),
          },
          host: urlObj.hostname,
          port: urlObj.port, // null if https and 443 defined in url
          protocol: urlObj.protocol, // http: or https:
          rejectUnauthorized: false, // accepts self-siged certificates
          // 'method' and 'path' added at the end
        },
      };

      // proxy
      if (
        config.entity[baseEntity].proxy &&
        config.entity[baseEntity].proxy.host
      ) {
        const agent = new HttpsProxyAgent(config.entity[baseEntity].proxy.host);
        param.options.agent = agent; // proxy
        if (
          config.entity[baseEntity].proxy.username &&
          config.entity[baseEntity].proxy.password
        ) {
          param.options.headers["Proxy-Authorization"] =
            "Basic " +
            Buffer.from(
              `${
                config.entity[baseEntity].proxy.username
              }:${scimgateway.getPassword(
                `endpoint.entity.${baseEntity}.proxy.password`,
                configFile
              )}`
            ).toString("base64"); // using proxy with auth
        }
      }

      if (!_serviceClient[baseEntity]) _serviceClient[baseEntity] = {};
      if (!_serviceClient[baseEntity][clientIdentifier])
        _serviceClient[baseEntity][clientIdentifier] = {};
      _serviceClient[baseEntity][clientIdentifier] = param; // serviceClient created
    }

    const cli = scimgateway.copyObj(
      _serviceClient[baseEntity][clientIdentifier]
    ); // client ready

    // failover support
    path = _serviceClient[baseEntity][clientIdentifier].baseUrl + path;
    urlObj = new URL(path);
    cli.options.host = urlObj.hostname;
    cli.options.port = urlObj.port;
    cli.options.protocol = urlObj.protocol;

    // adding none static
    cli.options.method = method;
    cli.options.path = `${urlObj.pathname}${urlObj.search}`;
    if (opt) cli.options = scimgateway.extendObj(cli.options, opt); // merge with argument options

    return cli; // final client
  }
  //
  // url path - none config based and used as is (no cache)
  //
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] ${action}: Using none config based client`
  );
  let options = {
    json: true,
    headers: {
      "Content-Type": "application/json",
    },
    host: urlObj.hostname,
    port: urlObj.port,
    protocol: urlObj.protocol,
    method: method,
    path: urlObj.pathname,
  };

  // proxy
  if (config.entity[baseEntity].proxy && config.entity[baseEntity].proxy.host) {
    const agent = new HttpsProxyAgent(config.entity[baseEntity].proxy.host);
    options.agent = agent; // proxy
    if (
      config.entity[baseEntity].proxy.username &&
      config.entity[baseEntity].proxy.password
    ) {
      options.headers["Proxy-Authorization"] =
        "Basic " +
        Buffer.from(
          `${
            config.entity[baseEntity].proxy.username
          }:${scimgateway.getPassword(
            `endpoint.entity.${baseEntity}.proxy.password`,
            configFile
          )}`
        ).toString("base64"); // using proxy with auth
    }
  }

  // merge any argument options - support basic auth using {auth: {username: "username", password: "password"} }
  if (opt) {
    const o = scimgateway.copyObj(opt);
    if (o.auth) {
      options.headers.Authorization =
        "Basic " +
        Buffer.from(`${o.auth.username}:${o.auth.password}`).toString("base64");
      delete o.auth;
    }
    options = scimgateway.extendObj(options, o);
  }

  const cli = {};
  cli.options = options;
  return cli; // final client
};

const updateServiceClient = (baseEntity, clientIdentifier, obj) => {
  if (
    _serviceClient[baseEntity] &&
    _serviceClient[baseEntity][clientIdentifier]
  )
    _serviceClient[baseEntity][clientIdentifier] = scimgateway.extendObj(
      _serviceClient[baseEntity][clientIdentifier],
      obj
    ); // merge with argument options
};

//
// doRequest - execute REST service
//
const doRequest = async (
  baseEntity,
  method,
  path,
  body,
  ctx,
  opt,
  retryCount
) => {
  try {
    const cli = await getServiceClient(baseEntity, method, path, opt, ctx);
    const options = cli.options;
    const result = await new Promise((resolve, reject) => {
      let dataString = "";
      if (body) {
        if (
          options.headers["Content-Type"].toLowerCase() ===
          "application/x-www-form-urlencoded"
        ) {
          if (typeof data === "string") dataString = body;
          else dataString = querystring.stringify(body); // JSON to query string syntax + URL encoded
        } else dataString = JSON.stringify(body);
        options.headers["Content-Length"] = Buffer.byteLength(
          dataString,
          "utf8"
        );
      }

      const reqType =
        options.protocol.toLowerCase() === "https:"
          ? https.request
          : http.request;
      const req = reqType(options, (res) => {
        const { statusCode, statusMessage } = res; // solving parallel problem (const + don't use res.statusCode)

        let responseString = "";
        res.setEncoding("utf-8");

        res.on("data", (chunk) => {
          responseString += chunk;
        });

        res.on("end", () => {
          const response = {
            statusCode: statusCode,
            statusMessage: statusMessage,
            body: null,
          };
          try {
            if (responseString) response.body = JSON.parse(responseString);
          } catch (err) {
            response.body = responseString;
          }
          if (statusCode < 200 || statusCode > 299)
            reject(new Error(JSON.stringify(response)));
          resolve(response);
        });
      }); // req

      req.on("socket", (socket) => {
        socket.setTimeout(60000); // connect and wait timeout => socket hang up
        socket.on("timeout", function () {
          req.abort();
        });
      });

      req.on("error", (error) => {
        // also catching req.abort
        req.end();
        reject(error);
      });

      if (dataString) req.write(dataString);
      req.end();
    }); // Promise

    scimgateway.logger.debug(
      `${pluginName}[${baseEntity}] doRequest ${method} ${options.protocol}//${
        options.host
      }${options.port ? `:${options.port}` : ""}${path} Body = ${JSON.stringify(
        body
      )} Response = ${JSON.stringify(result)}`
    );
    return result;
  } catch (err) {
    // includes failover/retry logic based on config baseUrls array
    scimgateway.logger.error(
      `${pluginName}[${baseEntity}] doRequest ${method} ${path} Body = ${JSON.stringify(
        body
      )} Error Response = ${err.message}`
    );
    let statusCode;
    try {
      statusCode = JSON.parse(err.message).statusCode;
    } catch (e) {}
    const clientIdentifier = getClientIdentifier(ctx);
    if (!retryCount) retryCount = 0;
    let urlObj;
    try {
      urlObj = new URL(path);
    } catch (err) {}
    if (!urlObj && (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND")) {
      if (retryCount < config.entity[baseEntity].baseUrls.length) {
        retryCount++;
        updateServiceClient(baseEntity, clientIdentifier, {
          baseUrl: config.entity[baseEntity].baseUrls[retryCount - 1],
        });
        scimgateway.logger.debug(
          `${pluginName}[${baseEntity}] ${
            config.entity[baseEntity].baseUrls.length > 1 ? "failover " : ""
          }retry[${retryCount}] using baseUrl = ${
            _serviceClient[baseEntity].baseUrl
          }`
        );
        const ret = await doRequest(
          baseEntity,
          method,
          path,
          body,
          ctx,
          opt,
          retryCount
        ); // retry
        return ret; // problem fixed
      } else {
        const newerr = new Error(err.message);
        newerr.message = newerr.message.replace(
          "ECONNREFUSED",
          "UnableConnectingService"
        ); // avoid returning ECONNREFUSED error
        newerr.message = newerr.message.replace(
          "ENOTFOUND",
          "UnableConnectingHost"
        ); // avoid returning ENOTFOUND error
        throw newerr;
      }
    } else {
      if (statusCode === 401 && _serviceClient[baseEntity])
        delete _serviceClient[baseEntity][clientIdentifier];
      throw err; // CA IM retries getUsers failure once (retry 6 times on ECONNREFUSED)
    }
  }
}; // doRequest

//
// Cleanup on exit
//
process.on("SIGTERM", () => {
  // kill
});
process.on("SIGINT", () => {
  // Ctrl+C
});
