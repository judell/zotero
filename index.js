function logWrite(msg) {
  console.log(msg);
  getById('viewer').innerHTML = `<div>${msg}</div>`;
}

function logAppend(msg) {
  console.log(msg);
  getById('viewer').innerHTML += `<div>${msg}</div>`;
}

function setZoteroApiKey() {
  setLocalStorageFromForm('zoteroApiKeyForm', 'h_zoteroApiKey');
}

function getZoteroApiKey() {
  return getFromUrlParamOrLocalStorage('h_zoteroApiKey')
}

function setZoteroUserId() {
  setLocalStorageFromForm('zoteroUserIdForm', 'h_zoteroUserId');
}

function getZoteroUserId() {
  return getFromUrlParamOrLocalStorage('h_zoteroUserId')
}

function sync() {
  var start = 0;
  var url = `https://www.zotero.org/api/users/${getZoteroUserId()}/items?start=${start}`;
  zoteroSearch(url, start, processZoteroSearchResults, []);
}

function zoteroSearch(url, start, callback, zoteroSearchResults) {

  var opts = {
    method: 'get',
    url: `https://www.zotero.org/api/users/${getZoteroUserId()}/items?limit=50&start=${start}`,
    headers: {
      "Zotero-API-Key": `${getZoteroApiKey()}`,
    },
  };

  httpRequest(opts)
    .then(function (data) {
      var items = JSON.parse(data.response);
      items.forEach(function (item) {
        var result = {
          key: item.key,
          version: item.version,
          doi: (item.data.DOI ? item.data.DOI : null),
          title: item.data.title,
          url: item.data.url,
          itemType: item.data.itemType,
        }
        zoteroSearchResults.push(result);
      });
      var total = data.headers['total-results'];
      logWrite(`fetching ${total} zotero items, got ${zoteroSearchResults.length} so far`);
      if (total && zoteroSearchResults.length >= parseInt(total)) {
        logWrite(`got ${total} zotero items`);
        zoteroSearchResults = zoteroSearchResults.filter(x => x.itemType != 'attachment' && x.itemType != 'note');
        logWrite(`filtering out attachments and notes leaves ${zoteroSearchResults.length} zotero items`);
        callback(zoteroSearchResults);
      } else {
        start += 50;
        zoteroSearch(url, start, callback, zoteroSearchResults);
      }
    })
    .catch(e => {
      console.log(e);
    });
}

function processZoteroSearchResults(zoteroSearchResults) {

  logWrite(`processing ${zoteroSearchResults.length} zotero search results`);
  //results = results.filter(x => x.doi != null && x.url );
  //console.log(`filtering out results with neither a doi nor a url leaves ${results.zoteroSearchResults`);
  var fetchWorker = new Worker('fetchAnnotations.js');
  var fetchWorkerResults = {};

  function proceedToPostNotes() {
    fetchWorker.terminate();
    postNotes(fetchWorkerResults);
  }

  fetchWorker.addEventListener('message', function (e) {
    var key = e.data.key;
    var url = e.data.url;
    fetchWorkerResults[key] = e.data;
    fetchWorkerResultCount = Object.keys(fetchWorkerResults).length;
    logWrite(`fetchWorker got response #${fetchWorkerResultCount} of ${zoteroSearchResults.length} expected`);
    if (fetchWorkerResultCount == zoteroSearchResults.length) {
      logWrite(`all ${fetchWorkerResultCount} messages received from fetchWorker, calling postWorker`);
      proceedToPostNotes();
    }
  });

  zoteroSearchResults.forEach(function (zoteroSearchResult) {
    fetchWorker.postMessage({
      doi: zoteroSearchResult.doi,
      zoteroInfo: zoteroSearchResult,
      token: getToken(),
    });
  });
}

function postNotes(fetchWorkerResults) {

  var timeoutSecs = 30;

  logWrite('');

  var postWorker = new Worker('postNotes.js');
  var keys = Object.keys(fetchWorkerResults);

  setTimeout(function () {
    logWrite(`postWorker timeout reached, sync done`);
    postWorker.terminate();
  }, timeoutSecs * 1000);

  logWrite(`postNotes got ${keys.length} fetchWorker results`);
  var keysWithAnnotations = keys.filter(x => fetchWorkerResults[x].hypothesisTotal > 0);
  logWrite(`postNotes filtered fetchWorker results to ${keysWithAnnotations} with annotations`);
  logWrite(`postNotes checking for unsynced annotations`);

  postWorker.addEventListener('message', function (e) {
    logAppend(`${e.data}`);
  });

  keysWithAnnotations.forEach(function (key) {
    postWorker.postMessage({
      zoteroUserId: getZoteroUserId(),
      zoteroApiKey: getZoteroApiKey(),
      workerResult: fetchWorkerResults[key],
    });
  });

  self.logAppend(`postNotes done, waiting for postWorker messages, will timeout in ${timeoutSecs} seconds`);
}

var tokenContainer = getById('tokenContainer');
createApiTokenInputForm(tokenContainer);

var userArgs = {
  element: getById('zoteroUserContainer'),
  name: 'Zotero numeric user ID',
  id: 'zoteroUserId',
  value: getZoteroUserId(),
  onChange: 'setZoteroUserId',
  type: '',
  msg: 'Zotero numeric user id from <a href="https://www.zotero.org/settings/keys">https://www.zotero.org/settings/keys</a>',
};

createNamedInputForm(userArgs);

var apiKeyArgs = {
  element: getById('zoteroApiKeyContainer'),
  name: 'Zotero API key',
  id: 'zoteroApiKey',
  value: getZoteroApiKey(),
  onChange: 'setZoteroApiKey',
  type: 'password',
  msg: 'Zotero API key from <a href="https://www.zotero.org/settings/keys">https://www.zotero.org/settings/keys</a>',
};

createNamedInputForm(apiKeyArgs);

var viewer = document.getElementById("viewer");