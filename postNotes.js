self.importScripts("https://jonudell.info/hlib/hlib.js");
self.importScripts("https://jonudell.info/hlib/showdown.js");

function postNote(key, version, zoteroUserId, zoteroApiKey, anno) {
  self.postMessage (`postWorker posting note for ${key}, ${anno.id}`);
  var converter = new Showdown.converter();
  var quote = anno.quote != '' ? `<blockquote>${anno.quote}</blockquote>` : '';
  var body = converter.makeHtml(anno.text);

  var html = `
    <p>Hypothesis <a href="https://hyp.is/${anno.id}">annotation</a> by ${anno.user}</p>
      ${quote}
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
      self.postMessage(`postWorker added ${anno.user}, <a href="https://hyp.is/${anno.id}">${anno.id}</a>`);
    });
}

self.addEventListener('message', function (e) {
  var zoteroUserId = e.data.zoteroUserId;
  var zoteroApiKey = e.data.zoteroApiKey;
  var key = e.data.workerResult.key;
  var url = e.data.workerResult.url;
  var title = e.data.workerResult.title;
  var version = e.data.workerResult.version;
  var annos = e.data.workerResult.hypothesisAnnos.rows;
  console.log (`postWorker received message for ${key} ${url}, with ${annos.length} annotations`);
  annos = annos.filter(x => ! x.hasOwnProperty('references'));
  //console.log (`postWorker filtering out replies leaves ${annos.length} top-level annotations`);
  annos.forEach( function(anno) {
    anno = parseAnnotation(anno);
    var opts = {
      method: 'get',
      url:`https://www.zotero.org/api/users/${zoteroUserId}/items/${key}/children`,
      headers: {
        "Zotero-API-Key": `${zoteroApiKey}`,
      },
    };
    console.log(`postWorker checking for existing zotero note on ${key} ${title} for ${anno.id}`);
    httpRequest(opts)
      .then ( function(data) {
        var children = JSON.parse(data.response);
        //console.log (`postWorker found ${children.length} items for ${key} ${title}`);
        children = children.filter(x => x.data.itemType == 'note');
        //console.log (`postWorker filtered items to just notes, leaving ${children.length}`);
        children = children.filter(x => x.data.note.indexOf(`https://hyp.is/${anno.id}`) != -1);
        if ( children.length == 0 ) {
          console.log (`postWorker found no existing zotero notes on ${key} for ${anno.id}, so posting`);
          postNote(key, version, zoteroUserId, zoteroApiKey, anno) ;
        }
      })
      .catch( e => {
        self.postMessage(`postWorker promise rejected for ${JSON.stringify(opts)}, ${JSON.stringify(e)}`);
      });
  });
});

