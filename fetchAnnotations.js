// this web worker fetches annotations for urls of zotero items

self.importScripts("https://jonudell.info/hlib/hlib.bundle.js");

// listen for a request to query hypothesis for annotations on a zotero item
self.addEventListener('message', function (e) {
  var doi = e.data.zoteroItem.doi;
  var url = e.data.zoteroItem.url;
  var key = e.data.zoteroItem.key;
  var token = e.data.token;

  var hypothesisQuery = `https://hypothes.is/api/search?uri=doi:${doi}&uri=${url}`;

  var opts = {
    method: 'get',
    url: hypothesisQuery,
  }

  if (token) {
    opts.headers = {
      'Authorization': 'Bearer ' + e.data.token,
      'Content-Type': 'application/json;charset=utf-8',
    };
  }
  
  // find hypothesis annotations on the url of a zotero item
  hlib.httpRequest(opts)
    .then( function (data) {
      var hypothesisInfo = JSON.parse(data.response);
      // message the caller with zotero item info plus hypothesis search results
      self.postMessage({
        key: key,
        version: e.data.zoteroItem.version,
        url: e.data.zoteroItem.url,
        title: e.data.zoteroItem.title,
        doi: e.data.zoteroItem.doi,
        hypothesisAnnos: JSON.parse(data.response),
        hypothesisTotal: hypothesisInfo.total,
      });
    })
    .catch( function(e) {
      self.postMessage({
        error: e,
        key: key,
        url: url,
      });
    });

});