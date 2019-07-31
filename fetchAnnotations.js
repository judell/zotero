// this web worker fetches annotations for urls of zotero items

debugger

self.importScripts('https://jonudell.info/hlib/hlib2.bundle.js')

// listen for a request to query hypothesis for annotations on a zotero item
self.addEventListener('message', function(e) {
	const url = e.data.zoteroItem.url
	const key = e.data.zoteroItem.key
	const token = e.data.token

	const hypothesisQuery = `https://hypothes.is/api/search?uri=${url}`

	const opts = {
		method: 'get',
		url: hypothesisQuery
	}

	if (token) {
		opts.headers = {
			Authorization: 'Bearer ' + e.data.token,
			'Content-Type': 'application/json;charset=utf-8'
		}
	}

	// find hypothesis annotations for a zotero item
	hlib
		.httpRequest(opts)
		.then(function(data) {
			const hypothesisInfo = JSON.parse(data.response)
			// message the caller with zotero item info plus hypothesis search results
			self.postMessage({
				key: key,
				version: e.data.zoteroItem.version,
				url: e.data.zoteroItem.url,
				title: e.data.zoteroItem.title,
				doi: e.data.zoteroItem.doi,
				hypothesisAnnos: hypothesisInfo.rows,
				hypothesisTotal: hypothesisInfo.total
			})
		})
		.catch(function(e) {
			self.postMessage({
				error: e,
				key: key,
				url: url
			})
		})
})
