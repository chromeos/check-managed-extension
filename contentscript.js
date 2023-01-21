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
 * Client tab message send on start
 */
chrome.runtime.sendMessage({type:'start'});

/**
 * Set a listener for message passing
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type == 'request') {
      getClientInfo(request.item);
    }
    if (request.type == 'backend') {
      console.log(request);
    }
    sendResponse({ response: true });
});

/**
 * Get the Client information available. Send to the backend.
 * @param {object} e
 */

async function getClientInfo(e) {
    let infocache = cache('info');
    if (!infocache || Object.keys(infocache).length<=1) {
        infocache = await fetchInfo();
        cache('info', infocache);
    }
    if (e) {
        infocache = { ...infocache, ...e };
    }
    console.log('infocache',infocache);
    chrome.runtime.sendMessage(infocache);
}

/**
 * Format the client information and return
 * @returns
 */
async function fetchInfo() {
    const info = {
        agent: navigator.userAgent,
        platform: navigator.platform.replace(/_/g, '-'),
    };
    return info;
}

/**
 * Cache a value to the local chrome storage for a limited time period.
 *
 * @param {string} key
 * @param {*} value
 * @param {integer} time
 * @param {boolean} override
 * @returns
 */

function cache(key, value, time=21600000, override = false) {
    let info = localStorage.getItem(key);

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
    } catch (e) { console.log(e, info); }

    return info;
}
