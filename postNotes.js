// this web worker imports hypothesis annotations into zotero as child notes
// it adds a zotero tag to each imported note like 'hypothesis-BvFJGPmpRd-7d6g7_sOpFg'

debugger;

self.importScripts("https://jonudell.info/hlib/hlib.js");
self.importScripts("https://jonudell.info/hlib/showdown.js");

function importAnnotation(key, version, zoteroUserId, zoteroApiKey, anno) {
  var converter = new Showdown.converter();
  var quote = anno.quote != '' ? `<blockquote>${anno.quote}</blockquote>` : '';
  var body = converter.makeHtml(anno.text);

  var html = `
    <p>Hypothesis <a href="https://hyp.is/${anno.id}">annotation</a> by ${anno.user}</p>
      ${quote}
      ${body}
    `;

  // params for the zotero api call to create a hypothesis-derived child note
  var params = [
    {
      "parentItem" : key,
      "itemType" : "note",
      "note" : html,
      "tags" : ['hypothesis-'+anno.id].concat(anno.tags),
      "collections" : [],
      "relations" : {}
    }
  ];

  var zoteroApiCall = `https://www.zotero.org/api/users/${zoteroUserId}/items/`;

  var opts = {
    method: 'post',
    url: zoteroApiCall,
    params: JSON.stringify(params),
    headers: {
      "Zotero-API-Key": `${zoteroApiKey}`,
    },
  }

  // call zotero api to import a hypothesis-derived child note
  return httpRequest(opts);
}

var zoteroItemTotal;
var zoteroItemCounter = 0;
var importedAnnoTotal = 0;

// listen for requests to import annotations for a zotero item
self.addEventListener('message', function (e) {
  zoteroItemTotal = e.data.total; // each message has the same total

  self.postMessage(`checking for new annotations on zotero item ${zoteroItemCounter+1} of ${zoteroItemTotal}`);
  var zoteroUserId = e.data.zoteroUserId;
  var zoteroApiKey = e.data.zoteroApiKey;
  var key = e.data.annotationsToImport.key;
  var version = e.data.annotationsToImport.version;
  var rows = e.data.annotationsToImport.hypothesisAnnos.rows;

  let annoCount = 0;
  rows.forEach( function(row) {
    var anno = parseAnnotation(row); 
    importAnnotation(key, version, zoteroUserId, zoteroApiKey, anno)
      .then( () =>  {
        let user = `${anno.user}`.replace('acct:','').replace('@hypothes.is','');
        self.postMessage(`imported: ${user}, <a href="https://hyp.is/${anno.id}">${anno.id}</a>`);
        importedAnnoTotal += 1;
        annoCount += 1;
        if ( annoCount == rows.length ) {
          if (zoteroItemCounter == zoteroItemTotal) {
            reportDone(importedAnnoTotal);
          }
        }
      })
      .catch( e =>  {
        self.postMessage(e);
      });
  });

  zoteroItemCounter += 1;

  if ( rows.length == 0 && zoteroItemCounter == zoteroItemTotal ) {
    reportDone(importedAnnoTotal);
  }
  
});

function reportDone(importedAnnoTotal) {
  self.postMessage(`imported ${importedAnnoTotal} annotations`);
  self.postMessage('done');
}

