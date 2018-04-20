self.importScripts("https://jonudell.info/hlib/hlib.js");
self.importScripts("https://jonudell.info/hlib/showdown.js");

function postNote(key, version, zoteroUserId, zoteroApiKey, annoId, annoUser, annoText) {

  var converter = new Showdown.converter();
  var body = converter.makeHtml(annoText);

  var html = `
    <p>Hypothesis <a href="https://hyp.is/${annoId}">annotation</a> by ${annoUser}</p>
      ${body}
    `;

  var params = [
    {
      "parentItem" : key,
      "itemType" : "note",
      "note" : html,
      "tags" : [],
      "collections" : [],
      "relations" : {}
    }
  ];

  var apiCall = `https://www.zotero.org/api/users/${zoteroUserId}/items/`;

  var opts = {
    method: 'post',
    url: apiCall,
    params: JSON.stringify(params),
    headers: {
      "Zotero-API-Key": `${zoteroApiKey}`,
    },
  }

  httpRequest(opts)
    .then(function (data) {
      self.postMessage(`${annoUser}, <a href="https://hyp.is/${annoId}">${annoId}</a>`);
    });
}

self.addEventListener('message', function (e) {
  var zoteroUserId = e.data.zoteroUserId;
  var zoteroApiKey = e.data.zoteroApiKey;
  var key = e.data.workerResult.key;
  var version = e.data.workerResult.version;
  var annos = e.data.workerResult.hypothesisAnnos.rows;
  annos = annos.filter(x => ! x.hasOwnProperty('references'));
  annos.forEach( function(anno) {
    anno = parseAnnotation(anno);
    var opts = {
      method: 'get',
      url:`https://www.zotero.org/api/users/${zoteroUserId}/items/${key}/children`,
      headers: {
        "Zotero-API-Key": `${zoteroApiKey}`,
      },
    };
    httpRequest(opts)
      .then ( function(data) {
        var children = JSON.parse(data.response);
        children = children.filter(x => x.data.itemType == 'note');
        children = children.filter(x => x.data.note.indexOf(`https://hyp.is/${anno.id}`) != -1 );
        if ( children.length == 0 ) {
          postNote(key, version, zoteroUserId, zoteroApiKey, anno.id, anno.user, anno.text) ;
        }
      });
  });
});

