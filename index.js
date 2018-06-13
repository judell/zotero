function logWrite(msg) {
  console.log(msg);
  hlib.getById('viewer').innerHTML = `<div>${msg}</div>`;
}

function logAppend(msg) {
  console.log(msg);
  hlib.getById('viewer').innerHTML += `<div>${msg}</div>`;
}

function setZoteroApiKey() {
  hlib.setLocalStorageFromForm('zoteroApiKeyForm', 'h_zoteroApiKey');
}

function getZoteroApiKey() {
  return hlib.getFromUrlParamOrLocalStorage('h_zoteroApiKey')
}

function setZoteroUserId() {
  hlib.setLocalStorageFromForm('zoteroUserIdForm', 'h_zoteroUserId');
}

function getZoteroUserId() {
  return hlib.getFromUrlParamOrLocalStorage('h_zoteroUserId')
}

// main entry point, wired to sync button
function sync() {
  var offset = 0; 
  var url = `https://www.zotero.org/api/users/${getZoteroUserId()}/items?start=${offset}`; 
  collectZoteroItems(url, offset, [], [], processZoteroItems);
}

// url: zotero item enumerator
// offset: for api paging
// zoteroItems: accumulator for items in the zotero library
// hypothesisNotes: subset of items that are notes imported from hypothesis
// processZoteroItems: handler called when all items collected
 function collectZoteroItems(url, offset, zoteroItems, hypothesisNotes, processZoteroItems) {

  var opts = {
    method: 'get',
    url: `https://www.zotero.org/api/users/${getZoteroUserId()}/items?limit=50&start=${offset}`,
    headers: {
      "Zotero-API-Key": `${getZoteroApiKey()}`,
    },
  };

  hlib.httpRequest(opts)
    .then(function (data) {
      var items = JSON.parse(data.response);
      // summarize results and accumulate them into the array zoteroItems
      items.forEach(function (item) {
        var result = {
          key: item.key,
          version: item.version,
          doi: (item.data.DOI ? item.data.DOI : null),
          title: item.data.title,
          url: item.data.url,
          itemType: item.data.itemType,
          tags: item.data.tags,
        }
        zoteroItems.push(result);
      });
      var total = parseInt(data.headers['total-results']);
      logWrite(`fetching ${total} zotero items, got ${zoteroItems.length} so far`);
      if (total && zoteroItems.length >= total) {
        logWrite(`got ${total} zotero items`);
        // remove attachments
        zoteroItems = zoteroItems.filter(x => { return x.itemType != 'attachment' });
        logWrite(`removing attachments leaves ${zoteroItems.length} zotero items`);
        // collect zotero notes that represent imported hypothesis annotations
        // it's the subset of notes with tags prefixed like 'hypothesis-BvFJGPmpRd-7d6g7_sOpFg
        // and suffixed with hypothesis ids that are in zotero and won't be reimported
        let _hNotes = zoteroItems.filter(x => { return x.itemType === 'note' && x.tags.length > 0 }); // filter to notes with tags
        _hNotes = _hNotes.filter(x => { return hasHypothesisTag(x) }) // that match the prefix
        hypothesisNotes = hypothesisNotes.concat(_hNotes); 
        let _hKeys = _hNotes.map(x => { return x.key }); // capture zotero keys for _hNotes
        zoteroItems = zoteroItems.filter(x => { return _hKeys.indexOf(x.key) == -1 }); // exclude _hNotes
        processZoteroItems(hypothesisNotes, zoteroItems);
      } else {
        // continue collecting until all pages of zotero api results are processed
        offset += 50;
        collectZoteroItems(url, offset, zoteroItems, hypothesisNotes, processZoteroItems);
      }
    })
    .catch(e => {
      logAppend(e);
    });
}

// hypothesisNotes: zoteroItems that are child notes from hypothesis
// zoteroItems: zoteroItems that are not child notes from hypothesis
function processZoteroItems(hypothesisNotes, zoteroItems) {

  logWrite(`processing ${zoteroItems.length} zotero search results`);
  // spawn a worker to fetch hypothesis annotations for zotero items
  var annotationFetcher = new Worker('fetchAnnotations.js');
  var annotationFetchResults = {}; 

  // listen for messages from the annotation fetcher
  annotationFetcher.addEventListener('message', function (e) {
    var key = e.data.key;
    annotationFetchResults[key] = e.data;
    let fetchedCount = Object.keys(annotationFetchResults).length;
    logWrite(`fetchWorker got response #${fetchedCount} of ${zoteroItems.length} expected`);
    // expect as many messages as zotero items, if fewer, the app will time out
    if (fetchedCount == zoteroItems.length) {
      logWrite(`all ${fetchedCount} messages received from annotation fetcher, calling importer`);
      annotationFetcher.terminate();
      // we have hypothesis annotations for all zotero items
      // now exclude annotations already imported 
      // for each zotero item we have an object like:
      /*
      { "79LKJ9G2": {
        ...
        hypothesisAnno: { "rows": []}
        ...
        }
      }
      */
      let resultsToImport = [];
      Object.keys(annotationFetchResults).forEach(zoteroKey => {
        let fetchedResultsForZoteroKey = annotationFetchResults[zoteroKey];
        let candidateRows = fetchedResultsForZoteroKey.hypothesisAnnos.rows;
        // exclude replies
        candidateRows = candidateRows.filter(x => { return !x.references });
        // get the ids of imported hypothesis notes
        let excludedIds = hypothesisNotes.map(x => { 
          let id = 'NoHypothesisId';
          x.tags.forEach(tag => {
            if (isHypothesisTag(tag)) {
              id = getHypothesisIdFromZoteroTag(tag);
            }
          });
          return id;
        });
        // filter out the excluded rows
        let importRows = candidateRows.filter(x => { 
          return excludedIds.indexOf(x.id) == -1;
        })
        // update fetched results with filtered rows
        fetchedResultsForZoteroKey.hypothesisAnnos.rows = importRows;
        resultsToImport = resultsToImport.concat(fetchedResultsForZoteroKey);
      });
      importer(resultsToImport);
    }
  });

  // message the worker once per zotero item
  zoteroItems.forEach(function (zoteroItem) {
    annotationFetcher.postMessage({
      zoteroItem: zoteroItem,
      token: hlib.getToken(), // hypothesis api token so worker can read private/group annotations
    });
  });
}

function getHypothesisIdFromZoteroTag(tag) {
  return tag['tag'].slice(11);
}
function isHypothesisTag(tag) {
  return tag['tag'].slice(0,11) === 'hypothesis-';
}

function hasHypothesisTag(zoteroItem) {
  var hasHypothesisTag = false;
  zoteroItem.tags.forEach(tag => {
    if (isHypothesisTag(tag)) {
      hasHypothesisTag = true;
    }
  });
  return hasHypothesisTag;
}

// called with a list of objects that contain a merge of zotero item info 
// and hypothesis api search results 
function importer(resultsToImport) {

  var timeoutSecs = 30;

  logWrite('');

  var importer = new Worker('postNotes.js');
  var zoteroKeys = Object.keys(resultsToImport);

  setTimeout(function () {
//    logWrite(`timeout reached`);
//    importer.terminate();
  }, timeoutSecs * 1000);

  // log messages from the importer, and terminate when it reports done
  importer.addEventListener('message', function (e) {
    logAppend(`${e.data}`);
    if ( e.data == 'done' ) {
      importer.terminate();  
    }
  });

  zoteroKeys.forEach(function (key) {
    // ask the worker to import annotations for a zotero item
    importer.postMessage({
      zoteroUserId: getZoteroUserId(),
      zoteroApiKey: getZoteroApiKey(),
      annotationsToImport: resultsToImport[key],
      total: zoteroKeys.length,
    });
  });
}

var tokenContainer = hlib.getById('tokenContainer');
hlib.createApiTokenInputForm(tokenContainer);

var userArgs = {
  element: hlib.getById('zoteroUserContainer'),
  name: 'Zotero numeric user ID',
  id: 'zoteroUserId',
  value: getZoteroUserId(),
  onchange: 'setZoteroUserId',
  type: '',
  msg: 'Zotero numeric user id from <a href="https://www.zotero.org/settings/keys">https://www.zotero.org/settings/keys</a>',
};

hlib.createNamedInputForm(userArgs);

var apiKeyArgs = {
  element: hlib.getById('zoteroApiKeyContainer'),
  name: 'Zotero API key',
  id: 'zoteroApiKey',
  value: getZoteroApiKey(),
  onchange: 'setZoteroApiKey',
  type: 'password',
  msg: 'Zotero API key from <a href="https://www.zotero.org/settings/keys">https://www.zotero.org/settings/keys</a>',
};

hlib.createNamedInputForm(apiKeyArgs);

var viewer = document.getElementById("viewer");