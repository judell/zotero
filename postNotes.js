// this web worker imports hypothesis annotations into zotero as child notes
// it adds a zotero tag to each imported note like 'hypothesis-BvFJGPmpRd-7d6g7_sOpFg'

// use hlib, not hlib2, because no web components in this environment
self.importScripts('https://jonudell.info/hlib/hlib.bundle.js')
self.importScripts('https://jonudell.info/hlib/showdown.js')
debugger

// import a hypothesis annnotation as a zotero child note
function importAnnotation(zoteroKey, zoteroUserId, zoteroApiKey, anno) {
	const converter = new Showdown.converter()
	const quote = anno.quote != '' ? `<blockquote>${anno.quote}</blockquote>` : ''
	const body = converter.makeHtml(anno.text)

	const html = `
    <p>Hypothesis <a href="https://hyp.is/${anno.id}">annotation</a> by ${anno.user}</p>
      ${quote}
      ${body}`

	// params for the zotero api call to create a hypothesis-derived child note
	const tags = [ { tag: `hypothesis-${anno.id}` } ]
	for (let tag of anno.tags) {
		tags.push({ tag: tag })
	}
	const params = [
		{
			parentItem: zoteroKey,
			itemType: 'note',
			note: html,
			tags: tags,
			collections: [],
			relations: {}
		}
	]

	const zoteroApiCall = `https://www.zotero.org/api/users/${zoteroUserId}/items/`

	const opts = {
		method: 'post',
		url: zoteroApiCall,
		params: JSON.stringify(params),
		headers: {
			'Zotero-API-Key': `${zoteroApiKey}`
		}
	}

	// call zotero api to import a hypothesis-derived child note
	return hlib.httpRequest(opts)
}

// listen for a request to import one or more hypothesis annotations for a zotero item
self.addEventListener('message', e => {
	const zoteroUserId = e.data.zoteroUserId
	const zoteroApiKey = e.data.zoteroApiKey
	const zoteroKey = e.data.annotationsToImport.key
	const rows = e.data.annotationsToImport.hypothesisAnnos

	rows.forEach(row => {
		const anno = hlib.parseAnnotation(row)
		importAnnotation(zoteroKey, zoteroUserId, zoteroApiKey, anno)
			.then(_ => {
				let user = `${anno.user}`.replace('acct:', '').replace('@hypothes.is', '')
				self.postMessage(
					`imported <a class="url" target="_anno" href="https://hypothes.is/a/${anno.id}">${anno.id}</a> by ${user} on ${anno.url}`
				)
				self.postMessage({
					zoteroKey: zoteroKey // echo back the zotero key so caller can track progress
				})
			})
			.catch(e => {
				self.postMessage(e)
			})
	})
})
