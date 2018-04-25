self.importScripts("https://jonudell.info/hlib/hlib.js");

self.addEventListener('message', function (e) {
  var doi = e.data.doi;
  var url = e.data.zoteroInfo.url;
  var key = e.data.zoteroInfo.key;

  var hypothesisQuery = `https://hypothes.is/api/search?uri=doi:${doi}&uri=${url}`;

  var opts = {
    method: 'get',
    url: hypothesisQuery,
  }

  if (e.data.token) {
    opts.headers = {
      'Authorization': 'Bearer ' + e.data.token,
      'Content-Type': 'application/json;charset=utf-8',
    };
  }

  httpRequest(opts)
    .then( function (data) {
      var hypothesisInfo = JSON.parse(data.response);
      self.postMessage({
        key: key,
        version: e.data.zoteroInfo.version,
        url: e.data.zoteroInfo.url,
        title: e.data.zoteroInfo.title,
        doi: e.data.zoteroInfo.doi,
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