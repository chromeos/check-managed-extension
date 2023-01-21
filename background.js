/* Copyright 2023 Google LLC
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*      http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License. */

/**
 * Admin console configured managed settings
 */
const managed = {};

/**
 * In memory storage
 */
const storage = [];

/**
 * Javascript and determined types to BigQuery types
 */
const BQDict = {
  'number': 'NUMERIC',
  'bigint': 'BIGNUMERIC',
  'string': 'STRING',
  'boolean': 'BOOL',
  'date': 'DATE',
  'datetime': 'DATETIME',
};

/**
 * Checks if the object is empty
 *
 * @param {object} obj
 * @returns
 */
const isEmpty = (obj) => Object.keys(obj).length === 0;

/**
 * Helper for local storage
 */
const localStorage = {
  getAllItems: () => chrome.storage.local.get(),
  getItem: async key => (await chrome.storage.local.get(key))[key],
  setItem: (key, val) => chrome.storage.local.set({ [key]: val }),
  removeItems: keys => chrome.storage.local.remove(keys),
};

/**
 * Removes object parameters which are empty
 *
 * @param {object} obj
 * @returns
 */
const clearEmptyObjects = (obj) => {
  Object.keys(obj).forEach(k => {
    if (typeof obj[k] == 'object') {
      if (!obj[k]) {
        delete obj[k];
      }
      else if (Object.keys(obj[k]).length == 0) {
        delete obj[k];
      }
      else {
        obj[k] = clearEmptyObjects(obj[k]);
      }
    }
  });
  return obj;
};

/**
 * Helper to clear local storage
 */
const clearStorage = () => {
  chrome.storage.local.clear();
};

/**
 * Cache a value to the local chrome storage for a limited time period.
 *
 * @param {string} key
 * @param {*} value
 * @param {integer} time
 * @param {boolean} override
 * @returns
 */

const cache = async (key, value, time = 21600000, override = false) => {
  let info = await localStorage.getItem(key);

  //no cache and not saving a value
  if (!info && !value) {
    return null;
  }

  //if the value isn't an object assign as an object
  if (typeof value != 'object') {
    value = { value: value };
  }

  //overriding and forcing the cache storage
  if (key && value && override) {
    value.timestamp = new Date().getTime();
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  }

  //no currently stored value, first time save
  if (!info && value) {
    value.timestamp = new Date().getTime();
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  }

  //safety
  if (!info) {
    return null;
  }

  info = JSON.parse(info);
  try {
    const date = new Date(info.timestamp);
    //updating cache if expired
    if ((Date.now() > date.getTime() + time) && value) {
      value.timestamp = new Date().getTime();
      localStorage.setItem(key, JSON.stringify(value));
      return value;
    }
  } catch (e) {
    if (managed.debug) sendInfo({ type: 'backend', cache: e, info: info });
  }

  return info;
};

/**
 * Helper to convert object the JSON format
 * @param {object} obj
 * @returns
 */

const toJson = (obj) => {
  const json = {};
  for (let x in obj) {
    if (typeof obj[x] != 'function') {
      json[x] = obj[x];
    }
    if (typeof obj[x] == 'object') {
      json[x] = toJson(obj[x]);
    }
  }
  return json;
};

/**
 * Initalizes the managed storage values and sets the service worker alarms
 */
async function startup() {
  try {
    await getManagedStorage();
  } catch (e) {
    try {
      if (managed.debug) sendInfo({
        type: 'backend', message: 'startup', err: e
      });
    } catch (e) { }
  }
  setAlarm();
}

/**
 * Pulls the JSON object set from the Admin Console, saves to local storage and
 * assigns to a variable
 * @returns {object} data
 */

function getManagedStorage() {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.managed.get(null, function (data) {
        Object.keys(data).forEach(k => {
          localStorage.setItem(k, data[k]);
          managed[k] = data[k];
        });
        resolve(data);
      });
    } catch (e) {
      resolve('');
    }
  });
}

/**
 * Checks the state of the manage variabble and requests again if empty
 */

async function getManaged() {
  if (isEmpty(managed)) {
    getManagedStorage();
  }

  if (managed.debug) sendInfo({ type: 'backend', managed: managed });
}

/**
 * Set the service worker alarms
 */

async function setAlarm() {
  let period = managed.period ? managed.period : 5;
  let frequency = managed.frequency ? managed.frequency : 2;
  let tabactivity = managed.tabactivity ? managed.tabactivity : true;

  if (managed.debug) sendInfo({ type: 'backend', managed: { tabactivity: tabactivity, frequency: frequency, period: period } });

  chrome.alarms.getAll((alarms) => {
    const names = alarms.map(a => a.name);
    if (!names.includes('sendToBackend')) {
      chrome.alarms.create('sendToBackend', { delayInMinutes: 1, periodInMinutes: period });
      chrome.alarms.onAlarm.addListener((e) => {
        if (e.name == 'sendToBackend') sendToBackend();
      });
    }
    if (!names.includes('request')) {
      chrome.alarms.create('request', { delayInMinutes: 1, periodInMinutes: frequency });
      chrome.alarms.onAlarm.addListener((e) => {
        if (e.name == 'request') requestData(null, 'timed check');
      });
    }
  });

  if (managed.tabactivity) {
    try {
      chrome.tabs.onActivated.removeListener(activatedRequest);
    } catch (e) { }
    chrome.tabs.onActivated.addListener(activatedRequest);
  }
}

/**
 * Callback when a tab is activated
 */
function activatedRequest() {
  requestData(null, 'tab activated');
}

/**
 * Sets the event listener of installations
 */
chrome.runtime.onInstalled.addListener(async () => {
  clearStorage();
  await cache('schema', null, 600, true);
  requestData(null, 'install');
});

/**
 * Sets the event listener for extension startup
 */

chrome.runtime.onStartup.addListener(async () => {
  requestData(null, 'startup');
});

/**
 * Sets the event listener for managed installation
 */
chrome.management.onInstalled.addListener(() => {
  requestData(null, 'managed install');
});

/**
 * Sets the ebvent listener for extension removal
 */
chrome.management.onUninstalled.addListener(sendToBackend);

/**
 * Sets the event listener for when a window is removed.
 */
chrome.windows.onRemoved.addListener(sendToBackend);
/**
 * Sets the event listener for when the extension is suspended
 */
chrome.runtime.onSuspend.addListener(sendToBackend);
/**
 * Sets the event listener for when a device restart is requested
 */
chrome.runtime.onRestartRequired.addListener(sendToBackend);

/**
 * Sets the listener for message passing
 */

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request && request.type == 'start') {
    if (managed.debug) sendInfo({ type: 'backend', message: 'starting' });
    startup();
    requestData(null, 'loaded');
  } else {
    updateData(request);
  }
  sendResponse({ received: true });
});

/**
 * Formats and appends data from the backend to the the client request.
 * Sends to the data storage cache.
 * @param {object} request
 */
async function updateData(request) {
  try {
    if (request.agent) {
      switch (true) {
        case /CrOS/.test(request.agent):
          request.os = 'ChromeOS';
          break;
        case /Android/.test(request.agent):
          request.os = 'Android';
          break;
        case /Mac/.test(request.agent):
          request.os = 'MacOS';
          break;
        case /Win/.test(request.agent):
          request.os = 'Windows';
          break;
        case /Linux/.test(request.agent):
          request.os = 'Linux';
          break;
        default:
          request.os = 'Unknown';
          break;
      }
      request.chromeversion = request.agent.match('Chrome\/([0-9]*\.[0-9]*\.[0-9]*\.[0-9]*)')[1];
    }
    let device = await localStorage.getItem('device');

    if (!device || (device && Object.keys(device).length == 0)) {
      const values = await getAllDeviceInfo();
      device = {
        getDeviceSerialNumber: values[0],
        getDeviceAnnotatedLocation: values[1],
        getDeviceAssetId: values[2],
        getDirectoryDeviceId: values[3],
        getDeviceHostname: values[4],
        getHardwarePlatform: values[6],
        ismanaged: values[3] ? true : false
      };

      if (values[5] && Object.keys(values[5]).length > 0) {
        device = { ...device, ...values[5] };
      } else if (values[5]) {
        device.getNetworkDetails = values[5];
      }
      if (values[7] && Object.keys(values[7]).length > 0) {
        const { modelName, numOfProcessors, archName } = values[7];
        device.modelName = modelName;
        device.archName = archName;
        device.numOfProcessors = numOfProcessors;
      }

      localStorage.setItem('device', JSON.stringify(device));
    }
    if (!device) {
      device = {};
    }
    if (typeof device == 'string') {
      device = JSON.parse(device);
    }

    let ip = await cache('ip');
    if (!ip) {
      ip = await getIP();
      cache('ip', ip, (3600 + Math.floor(Math.random() * 1000)));
    }
    if (ip && ip.value) {
      ip = { ip: ip.value };
    }

    const user = await getUser();
    let deviceinfo = {};
    if (device && Object.keys(device).length > 0) {
      deviceinfo = device;
    }
    const allinfo = { ...request, ...user, ...ip, ...deviceinfo };

    if (managed.debug) sendInfo({ type: 'backend', allinfo: allinfo });

    if (allinfo.event) {
      sendData(allinfo);
    }


  } catch (e) {
    if (managed.debug) sendInfo({ type: 'backend', dataerror: e });
  }
}

/**
 * Sends data to a POST endpoint
 * @param {object} data
 * @param {string} url
 * @returns
 */
async function sendToSink(data, url) {
  if (!data || data.length == 0 || !url) {
    return;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    if (managed.debug) sendInfo({ type: 'backend', res: res });
  } catch (e) {
    if (managed.debug) sendInfo({ type: 'backend', res: e });
  }
}

/**
 * Retrieves managed device info
 * @returns {Array} Device Info
 */

function getAllDeviceInfo() {
  return Promise.all([getDeviceInfo('getDeviceSerialNumber'),
  getDeviceInfo('getDeviceAnnotatedLocation'),
  getDeviceInfo('getDeviceAssetId'),
  getDeviceInfo('getDirectoryDeviceId'),
  getDeviceInfo('getDeviceHostname'),
  getNetworkInfo(),
  getHardwarePlatform(),
  getSystemCpuInfo()
  ]);
}

/**
 * Retrieves network info for a managed device
 * @returns {object} getNetworkDetails
 */
function getNetworkInfo() {
  return new Promise((resolve, reject) => {
    try {
      chrome.enterprise.networkingAttributes.getNetworkDetails(resolve);
    } catch (e) {
      resolve('');
    }
  });
}

/**
 * Retrieves hardware info for a managed device
 * @returns {object} getHardwarePlatformInfo
 */

function getHardwarePlatform() {
  return new Promise((resolve, reject) => {
    try {
      chrome.enterprise.hardwarePlatform.getHardwarePlatformInfo(resolve);
    } catch (e) {
      resolve('');
    }
  });
}

/**
 * Retrieves managed device info
 * @param {string} type
 * @returns {object | string | number} Device info
 */

function getDeviceInfo(type) {
  return new Promise((resolve, reject) => {
    try {
      chrome.enterprise.deviceAttributes[type](resolve);
    } catch (e) {
      resolve('');
    }
  });
}

/**
 * Retrieves system CPU info
 * @returns {object} cpu info
 */

function getSystemCpuInfo() {
  return new Promise((resolve, reject) => {
    try {
      chrome.system.cpu.getInfo(resolve);
    } catch (e) {
      resolve('');
    }
  });
}

/**
 * Retrieves the logged in user information
 * @returns {object} User
 */
function getUser() {
  return new Promise((resolve, reject) => {
    try {
      chrome.identity.getProfileUserInfo(resolve);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Performs a GET call to a URL set on the the Admin Console.
 * Expects an unauthenticated url to retrieve the user IP address
 * @returns {object} ip info
 */
async function getIP() {
  const ipurl = managed.ipurl;
  if (!ipurl) {
    return {};
  }

  const res = await fetch(ipurl);
  const geoip = await res.json();
  if (ipurl.includes('ip-api.com')) {
    if (geoip.status) {
      delete geoip.status;
    }
    if (geoip.query && !geoip.ip) {
      geoip.ip = geoip.query;
      delete geoip.query;
    }
  }
  return geoip;
}

/**
 * Message passing to the client when the tab id is known
 * @param {object} e
 */
function sendInfo(e) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0].id) return;
    chrome.tabs.sendMessage(tabs[0].id, e);
  });
}

/**
 * Requests the client side information
 * @param {object} data
 * @param {string} event
 */
function requestData(data, event) {
  try {
    if (typeof data != 'object' || !data) { data = { tabId: data }; }
    if (event) data.event = event;
    if (data && data.tabId) {
      chrome.tabs.sendMessage(data.tabId, { type: 'request', item: data }, (res) => { });
    }
    else {
      sendInfo({ type: 'request', item: data });
    }
  } catch (e) {
    if (managed.debug) sendInfo({ type: 'backend', request: e });
  }
}

/**
 * Formats and Assigns data to the storage array
 * @param {object} e
 */
async function sendData(e) {
  try {
    getManaged();
  } catch (e) { }
  if (e.url) {
    const url = new URL(e.url);
    try {
      e.urlObject = toJson(url);
    } catch (e) {
      if (managed.debug) sendInfo({ type: 'backend', err: e });
    }
    delete e.urlObject.searchParams;
  }

  const schemaurl = managed.schemaurl;
  if (schemaurl) {
    let savedSchema = await cache('schema');
    if (savedSchema && savedSchema.value) {
      savedSchema = savedSchema.value;
    }
    if (!Array.isArray(savedSchema)) {
      savedSchema = null;
    }
    const schema = createSchema(e);

    const newSchema = checkSchema(schema, savedSchema);
    if (newSchema) {
      await cache('schema', schema, 600, true);
      await sendToSink(schema, schemaurl);
    }
  }
  const all = clearEmptyObjects(e);
  all.timestamp = new Date().getTime();
  storage.push(all);
}

/**
 * Sends the storage data to the sink and clears the storage
 * @returns
 */
async function sendToBackend() {
  if (managed.debug) sendInfo({ type: 'backend', storage: storage });

  const posturl = managed.posturl;
  if (!posturl) return;

  await sendToSink(storage, posturl);
  storage.splice(0, storage.length);
}

/**
 * Compares two objects
 * @param {object} schema
 * @param {object} savedSchema
 * @returns {boolean}
 */
function checkSchema(schema, savedSchema) {
  return objectCompare(schema, savedSchema);
}

function objectCompare(obj, savedObj) {
  let newSchema = false;
  if (!savedObj || savedObj.length == 0) {
    return true;
  }
  if ((!savedObj || savedObj.length == 0) && obj && obj.length > 0) {
    return true;
  }

  obj.forEach(k => {
    const saved = savedObj.find(o => o.name == k.name);
    if (saved && saved.type != k.type) {
      newSchema = true;
    }
    if (!saved) {
      newSchema = true;
    }
    if (k && k.type == 'STRUCT') {
      if (!saved) {
        newSchema = true;
      } else {
        newSchema = objectCompare(k.fields, saved.fields);
      }
    }

  });
  return newSchema;
}

/**
 * Creates a BigQuery schema from JSON object
 * @param {object} data
 * @returns
 */

function createSchema(data) {
  if (!data) return;
  const schema = [];
  const keys = Object.keys(data);
  keys.forEach(k => {
    const obj = {};
    const type = typeof data[k];
    if (type == 'object') {
      if (Array.isArray(data[k])) {
        obj['type'] = 'RECORD';
        obj['mode'] = 'REPEATED';
        const repeated = {};
        const fields = [];
        data[k].forEach((d, i) => {
          const atype = typeof d;
          if (atype == 'object') {
            const akeys = Object.keys(d);
            const rkeys = Object.keys(repeated);
            akeys.forEach(ak => {
              if (!rkeys.includes(ak)) {
                repeated[ak] = d[ak];
              }
              if (repeated[ak] == undefined && d[ak]) {
                repeated[ak] = d[ak];
              }
            });
          }
          else {
            const o = {
              name: `item${i}`,
              type: BQDict[typeof d]
            };
            fields.push(o);
          }
        });

        if (Object.keys(repeated).length > 0) {
          obj['fields'] = createSchema(repeated);
        }
        else if (fields && fields.length > 0) {
          obj['fields'] = fields;
        }
        else {
          obj['fields'] = createSchema(data[k][0]);
        }

      }
      else {
        obj['type'] = 'STRUCT';
        obj['fields'] = createSchema(data[k]);
        if (!obj['fields'] || obj['fields'].length == 0) {
          return;
        }
      }
    }
    else {
      obj['type'] = BQDict[type];
    }

    if (Object.keys(obj).length > 0) {
      obj['name'] = k;
      if (!obj['type']) {
        obj['type'] = 'STRING';
      }
      schema.push(obj);
    }
  });
  return schema;
}

