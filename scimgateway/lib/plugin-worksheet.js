// =================================================================================
// File:    plugin-worksheet.js
//
// Author: Qriar Labs
//
// Purpose: Connect with worksheets (xlsx and csv files)
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
const ExcelJS = require("exceljs");
const workbook = new ExcelJS.Workbook();

if (config?.connection?.authentication?.options?.password) {
  const password = scimgateway.getPassword(
    "endpoint.connection.authentication.options.password",
    configFile
  );
  config.connection.authentication.options.password = password;
}

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
        ...(await scimgateway
          .endpointMapper("outbound", { id: getObj.value }, config.map.user)
          .then((res) => res[0])),
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
        // loading file
        const { worksheet, headers } = await loadFile(config, "users");

        let idKey = Object.keys(filter)[0];

        // Mapping data rows to objects
        await worksheet.eachRow(async (row, rowNumber) => {
          if (rowNumber > 1) {
            const rowData = {};
            row.eachCell((cell, colNumber) => {
              const header = headers[colNumber - 1].key;
              rowData[header] = cell.value;
            });
            const scimUser = await scimgateway
              .endpointMapper("inbound", rowData, config.map.user)
              .then((res) => res[0]);

            if (idKey) {
              if (scimUser.id === filter[idKey]) {
                ret.Resources.push(scimUser);
              }
            } else {
              ret.Resources.push(scimUser);
            }
          }
        });
      }

      main()
        .then(async () => {
          //then function

          resolve(ret); // all explored users
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreUsers xlsx client connect error: ${err.message}`
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
    return await new Promise(async (resolve, reject) => {
      const body = await scimgateway
        .endpointMapper("outbound", userObj, config.map.user)
        .then((res) => res[0]);

      async function main() {
        // loading file
        const { worksheet } = await loadFile(config, "users");

        worksheet.addRow(Object.values(body));

        return await saveFile(config, "users");
      }

      main()
        .then(async () => {
          //then function

          resolve(null);
        })
        .catch(async (err) => {
          // catch function

          const e = new Error(
            `exploreUsers xlsx client connect error: ${err.message}`
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
    return await new Promise(async (resolve, reject) => {
      let formattedId = await scimgateway
        .endpointMapper("outbound", { id }, config.map.user)
        .then((res) => res[0]);

      async function main() {
        // loading file
        const { worksheet } = await loadFile(config, "users");

        let idKey = Object.keys(formattedId)[0];

        let ids = [];
        worksheet.getColumn(idKey).eachCell((cell, cellRow) => {
          if (cellRow > 1) ids.push(cell.value);
        });

        let rowToRemove = ids.indexOf(id);
        if (rowToRemove >= 0) {
          const isLast = worksheet.rowCount === rowToRemove + 2;
          if (isLast) {
            customSliceRow(worksheet, config, rowToRemove, []);
          } else {
            customSliceRow(worksheet, config, rowToRemove);
          }
        } else {
          throw new Error(`ID ${id} not found`);
        }

        return await saveFile(config, "users");
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
    return await new Promise(async (resolve, reject) => {
      const body = await scimgateway
        .endpointMapper("outbound", attrObj, config.map.user)
        .then((res) => res[0]);

      let formattedId = await scimgateway
        .endpointMapper("outbound", { id }, config.map.user)
        .then((res) => res[0]);

      async function main() {
        // loading file
        const { worksheet } = await loadFile(config, "users");

        let idKey = Object.keys(formattedId)[0];

        let ids = [];
        worksheet.getColumn(idKey).eachCell((cell, cellRow) => {
          if (cellRow > 1) ids.push(cell.value);
        });

        let rowToEdit = ids.indexOf(id);
        if (rowToEdit >= 0) {
          customSliceRow(worksheet, config, rowToEdit, {
            ...body,
            ...formattedId,
          });
        } else {
          throw new Error(`ID ${id} not found`);
        }

        return await saveFile(config, "users");
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
  let filter = {};
  if (getObj.operator) {
    if (
      getObj.operator === "eq" &&
      ["id", "displayName", "externalId"].includes(getObj.attribute)
    ) {
      // mandatory - unique filtering - single unique user to be returned - correspond to getUser() in versions < 4.x.x
      filter = {
        ...(await scimgateway
          .endpointMapper("outbound", { id: getObj.value }, config.map.user)
          .then((res) => res[0])),
      };
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
    filter = {};
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
        // loading file
        const { worksheet, headers } = await loadFile(config, "groups");

        let idKey = Object.keys(filter)[0];

        // Mapping data rows to objects
        await worksheet.eachRow(async (row, rowNumber) => {
          if (rowNumber > 1) {
            const rowData = {};
            row.eachCell((cell, colNumber) => {
              const header = headers[colNumber - 1].key;
              rowData[header] = cell.value;
            });
            const scimUser = await scimgateway
              .endpointMapper("inbound", rowData, config.map.group)
              .then((res) => res[0]);

            if (idKey) {
              if (scimUser.id === filter[idKey]) {
                ret.Resources.push(scimUser);
              }
            } else {
              ret.Resources.push(scimUser);
            }
          }
        });
      }

      main()
        .then(async () => {
          //then function

          resolve(ret); // all explored groups
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreGroups xlsx client connect error: ${err.message}`
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
    return await new Promise(async (resolve, reject) => {
      const body = await scimgateway
        .endpointMapper("outbound", groupObj, config.map.group)
        .then((res) => res[0]);

      async function main() {
        // loading file
        const { worksheet } = await loadFile(config, "groups");

        worksheet.addRow(Object.values(body));

        return await saveFile(config, "users");
      }

      main()
        .then(async () => {
          //then function

          resolve(null);
        })
        .catch(async (err) => {
          // catch function

          const e = new Error(
            `exploreGroups xlsx client connect error: ${err.message}`
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
    return await new Promise(async (resolve, reject) => {
      let formattedId = await scimgateway
        .endpointMapper("outbound", { id }, config.map.group)
        .then((res) => res[0]);

      async function main() {
        // loading file
        const { worksheet } = await loadFile(config, "groups");

        let idKey = Object.keys(formattedId)[0];

        let ids = [];
        worksheet.getColumn(idKey).eachCell((cell, cellRow) => {
          if (cellRow > 1) ids.push(cell.value);
        });

        let rowToRemove = ids.indexOf(id);
        if (rowToRemove >= 0) {
          const isLast = worksheet.rowCount === rowToRemove + 2;
          if (isLast) {
            customSliceRow(worksheet, config, rowToRemove, []);
          } else {
            customSliceRow(worksheet, config, rowToRemove);
          }
        } else {
          throw new Error(`ID ${id} not found`);
        }

        return await saveFile(config, "groups");
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
    return await new Promise(async (resolve, reject) => {
      const body = await scimgateway
        .endpointMapper("outbound", attrObj, config.map.group)
        .then((res) => res[0]);

      let formattedId = await scimgateway
        .endpointMapper("outbound", { id }, config.map.group)
        .then((res) => res[0]);

      async function main() {
        // loading file
        const { worksheet } = await loadFile(config, "groups");

        let idKey = Object.keys(formattedId)[0];

        let ids = [];
        worksheet.getColumn(idKey).eachCell((cell, cellRow) => {
          if (cellRow > 1) ids.push(cell.value);
        });

        let rowToEdit = ids.indexOf(id);
        if (rowToEdit >= 0) {
          customSliceRow(worksheet, config, rowToEdit, {
            ...body,
            ...formattedId,
          });
        } else {
          throw new Error(`ID ${id} not found`);
        }

        return await saveFile(config, "groups");
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

const loadFile = async (config, type) => {
  if (config.connection[type].fileType === "csv") {
    await workbook.csv.readFile(config.connection[type].filePath, {
      parserOptions: { delimiter: config.connection[type].delimiter },
    });
  } else {
    await workbook.xlsx.readFile(config.connection[type].filePath);
  }

  const worksheet = workbook.getWorksheet(config.connection[type].page);

  let headers = [];
  if (config.connection[type].headerOnFirstRow) {
    worksheet.getRow(1).eachCell((cell) => {
      headers.push({
        header: cell.value,
        key: cell.value,
      });
    });
  } else {
    if (
      worksheet.getRow(1).cellCount !== config.connection[type].header.length
    ) {
      throw new Error("Headers and columns must have the same length");
    }

    headers = config.connection[type].header.map((item) => ({
      header: item,
      key: item,
    }));
  }

  worksheet.columns = headers;

  return { worksheet, headers };
};

const customSliceRow = (worksheet, config, row, body) => {
  let add = 2;
  if (body) {
    worksheet.spliceRows(row + add, 1, body);
  } else {
    worksheet.spliceRows(row + add, 1);
  }
};

const saveFile = async (config, type) => {
  return await workbook[config.connection[type].fileType].writeFile(
    config.connection[type].filePath
  );
};

//
// Cleanup on exit
//
process.on("SIGTERM", () => {
  // kill
});
process.on("SIGINT", () => {
  // Ctrl+C
});
