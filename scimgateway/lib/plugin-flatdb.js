// =================================================================================
// File:    plugin-new-connector.js
//
// Author:
//
// Purpose: Custom SCIM Connector
//
// =================================================================================
"use strict";

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

if (config?.connection?.authentication?.options?.password) {
  const password = scimgateway.getPassword(
    "endpoint.connection.authentication.options.password",
    configFile
  );
  config.connection.authentication.options.password = password;
}

// imports
const FlatDB = require("flat-db");

// configure path to storage dir
FlatDB.configure({
  dir: `/home/node/app/data/${config.connection.workspace}/data`,
});

function getDefaultSchemaValue(type) {
  switch (type) {
    case "array":
      return [];
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      return "";
  }
}

let userSchema = {};

Object.keys(config.map.user).forEach((item, index) => {
  if (index > 0) {
    userSchema[item] = getDefaultSchemaValue(config.map.user[item].type);
  }
});

console.log(userSchema);

// create user collection with schema
const User = new FlatDB.Collection(config.connection.fileName, userSchema);

// =================================================
// getUsers
// =================================================
scimgateway.getUsers = async (baseEntity, getObj, attributes, ctx) => {
  //
  // "getObj" = { attribute: <>, operator: <>, value: <>, rawFilter: <>, startIndex: <>, count: <> }
  // rawFilter is always included when filtering
  // attribute, operator and value are included when requesting unique object or simpel filtering
  // See comments in the "mandatory if-else logic - start"
  //
  // "attributes" is array of attributes to be returned - if empty, all supported attributes should be returned
  // Should normally return all supported user attributes having id and userName as mandatory
  // id and userName are most often considered as "the same" having value = <UserID>
  // Note, the value of returned 'id' will be used as 'id' in modifyUser and deleteUser
  // scimgateway will automatically filter response according to the attributes list
  //
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

      filter = {
        ...scimgateway.endpointMapper(
          "outbound",
          { id: getObj.value },
          config.map.user
        )[0],
      };
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
        // get function (filter) (must return users)
        let users;
        if (getObj.value) {
          let result = User.get(getObj.value);
          users = result ? [result] : [];
        } else {
          users = User.all();
        }

        for (const row in users) {
          const scimUser = scimgateway.endpointMapper(
            "inbound",
            users[row],
            config.map.user
          )[0];
          ret.Resources.push(scimUser);
        }
      }

      main()
        .then(async () => {
          //then function

          resolve(ret); // all explored users
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreUsers new-connector client connect error: ${err.message}`
          );
          // catch function

          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

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
        // create function (body)
        const removing = User.add(body);
      }

      main()
        .then(async () => {
          //then function

          resolve(null);
        })
        .catch(async (err) => {
          // catch function

          const e = new Error(
            `exploreUsers new-connector client connect error: ${err.message}`
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
      let formattedId = scimgateway.endpointMapper(
        "outbound",
        { id },
        config.map.user
      )[0];

      async function main() {
        // delete function (id, formattedId)
        const removing = User.remove(id);
      }

      main()
        .then(async () => {
          //then function

          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `deleteUser Custom connector client connect error: ${err.message}`
          );
          // catch function

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

      let formattedId = scimgateway.endpointMapper(
        "outbound",
        { id },
        config.map.user
      )[0];

      async function main() {
        const updating = User.update(id, body);
      }

      main()
        .then(async () => {
          //then function

          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `modifyUser Custom connector client connect error: ${err.message}`
          );
          // catch function

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
  //
  // "getObj" = { attribute: <>, operator: <>, value: <>, rawFilter: <>, startIndex: <>, count: <> }
  // rawFilter is always included when filtering
  // attribute, operator and value are included when requesting unique object or simpel filtering
  // See comments in the "mandatory if-else logic - start"
  //
  // "attributes" is array of attributes to be returned - if empty, all supported attributes should be returned
  // Should normally return all supported group attributes having id, displayName and members as mandatory
  // id and displayName are most often considered as "the same" having value = <GroupName>
  // Note, the value of returned 'id' will be used as 'id' in modifyGroup and deleteGroup
  // scimgateway will automatically filter response according to the attributes list
  //
  const action = "getGroups";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" getObj=${
      getObj ? JSON.stringify(getObj) : ""
    } attributes=${attributes}`
  );

  // mandatory if-else logic - start
  if (getObj.operator) {
    if (
      getObj.operator === "eq" &&
      ["id", "displayName", "externalId"].includes(getObj.attribute)
    ) {
      // mandatory - unique filtering - single unique user to be returned - correspond to getUser() in versions < 4.x.x
    } else if (
      getObj.operator === "eq" &&
      getObj.attribute === "members.value"
    ) {
      // mandatory - return all groups the user 'id' (getObj.value) is member of - correspond to getGroupMembers() in versions < 4.x.x
      // Resources = [{ id: <id-group>> , displayName: <displayName-group>, members [{value: <id-user>}] }]
    } else {
      // optional - simpel filtering
    }
  } else if (getObj.rawFilter) {
    // optional - advanced filtering having and/or/not - use getObj.rawFilter
  } else {
    // mandatory - no filtering (!getObj.operator && !getObj.rawFilter) - all groups to be returned - correspond to exploreGroups() in versions < 4.x.x
  }
  // mandatory if-else logic - end

  try {
    return await new Promise((resolve, reject) => {
      const ret = {
        // itemsPerPage will be set by scimgateway
        Resources: [],
        totalResults: null,
      };

      async function main() {
        // get function (filter) (must return groups)

        for (const row in groups) {
          const scimGroup = scimgateway.endpointMapper(
            "inbound",
            groups[row],
            config.map.group
          )[0];
          ret.Resources.push(scimGroup);
        }
      }

      main()
        .then(async () => {
          //then function

          resolve(ret); // all explored groups
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreGroups new-connector client connect error: ${err.message}`
          );
          // catch function

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
        // create function (body)
      }

      main()
        .then(async () => {
          //then function

          resolve(null);
        })
        .catch(async (err) => {
          // catch function

          const e = new Error(
            `exploreGroups new-connector client connect error: ${err.message}`
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
      let formattedId = scimgateway.endpointMapper(
        "outbound",
        { id },
        config.map.group
      )[0];

      async function main() {
        // delete function (id, formattedId)
      }

      main()
        .then(async () => {
          //then function

          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `deleteUser Custom connector client connect error: ${err.message}`
          );
          // catch function

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

      let formattedId = scimgateway.endpointMapper(
        "outbound",
        { id },
        config.map.group
      )[0];

      async function main() {
        // update function (body, id, formattedId)
      }

      main()
        .then(async () => {
          //then function

          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `modifyUser Custom connector client connect error: ${err.message}`
          );
          // catch function

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

//
// Cleanup on exit
//
process.on("SIGTERM", () => {
  // kill
});
process.on("SIGINT", () => {
  // Ctrl+C
});
