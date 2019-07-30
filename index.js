function logWrite(msg) {
	console.log(msg)
	hlib.getById('viewer').innerHTML = `<div class="logMessage">${msg}</div>`
}

function logAppend(msg) {
	console.log(msg)
	hlib.getById('viewer').innerHTML += `<div class="logMessage">${msg}</div>`
}

function setZoteroApiKey() {
	hlib.setLocalStorageFromForm('zoteroApiKeyForm', 'h_zoteroApiKey')
}

function getZoteroApiKey() {
	return localStorage.getItem('h_zoteroApiKey')
}

function setZoteroUserId() {
	hlib.setLocalStorageFromForm('zoteroUserIdForm', 'h_zoteroUserId')
}

function getZoteroUserId() {
	return localStorage.getItem('h_zoteroUserId')
}

// necessary because hlib now uses fetch, which does not allow access to custom headers,
// and zotero returns total-results in a custom header

function _httpRequest(method, url, headers) {
	return new Promise(function(resolve, reject) {
		const xhr = new XMLHttpRequest()
		xhr.open(method, url)
		for (let header of headers) {
			const key = Object.keys(header)[0]
			xhr.setRequestHeader(key, header[key])
		}
		xhr.onload = function() {
			if (this.status >= 200 && this.status < 300) {
				resolve({
					response: xhr.response,
					total: xhr.getResponseHeader('total-results')
				})
			} else {
				reject({
					status: this.status,
					statusText: xhr.statusText
				})
			}
		}
		xhr.onerror = function() {
			reject({
				status: this.status,
				statusText: xhr.statusText
			})
		}
		xhr.send()
	})
}

// main entry point, wired to sync button
function sync() {
	const offset = 0
	collectZoteroItems(offset, [], [], processZoteroItems)
}

// url: zotero item enumerator
// offset: for api paging
// zoteroItems: accumulator for items in the zotero library
// hypothesisNotes: subset of items that are notes imported from hypothesis
// processZoteroItems: handler called when all items collected
function collectZoteroItems(offset, zoteroItems, hypothesisNotes, processZoteroItems) {
	const url = `https://www.zotero.org/api/users/${getZoteroUserId()}/items?start=${offset}&limit=50`
	const headers = [ { 'Zotero-API-Key': `${getZoteroApiKey()}` }, { Authorization: `Bearer ${hlib.getToken()}` } ]
	_httpRequest('get', url, headers)
		.then(function(data) {
			const items = JSON.parse(data.response)
			const total = parseInt(data.total)
			// summarize results and accumulate them into the array zoteroItems
			items.forEach(function(item) {
				const result = {
					key: item.key,
					version: item.version,
					doi: item.data.DOI ? item.data.DOI : null,
					title: item.data.title,
					url: item.data.url,
					itemType: item.data.itemType,
					tags: item.data.tags
				}
				zoteroItems.push(result)
			})
			logWrite(`fetched ${zoteroItems.length} of ${total} zotero items`)
			if (total && zoteroItems.length >= total) {
				logWrite('')
				// we have all the items in the zotero library
				// we need to query hypothesis for items that have urls, looking for annotations on them
				zoteroItems = zoteroItems.filter((x) => {
					let r = true
					if (x.itemType === 'attachment') {
						r = false // skip attachments, which have urls but are duplicative of primary types (newspaper article, blog post, etc.)
					}
					if (x.itemType !== 'note' && !x.url) {
						r = false // ignore non-attachments with no url (but keep notes)
					}
					return r
				})
				// collect zotero notes that represent imported hypothesis annotations
				// it's the subset of notes with tags prefixed like 'hypothesis-BvFJGPmpRd-7d6g7_sOpFg
				// and suffixed with hypothesis ids that are in zotero and won't be reimported
				let _hypothesisNotes = zoteroItems.filter((x) => {
					return x.itemType === 'note' && x.tags.length > 0 && hasHypothesisTag(x)
				}) // filter to zotero notes with hypothesis tags
				hypothesisNotes = hypothesisNotes.concat(_hypothesisNotes)
				let _hypothesisNoteKeys = _hypothesisNotes.map((x) => {
					return x.key
				}) // capture zotero keys for _hypothesisNotes
				zoteroItems = zoteroItems.filter((x) => {
					return _hypothesisNoteKeys.indexOf(x.key) == -1
				}) // exclude _hypothesisNotes
				zoteroItems = zoteroItems.filter((x) => {
					return x.url // exclude items with no url
				})
				processZoteroItems(hypothesisNotes, zoteroItems)
			} else {
				// continue collecting until all pages of zotero api results are processed
				offset += 50
				collectZoteroItems(offset, zoteroItems, hypothesisNotes, processZoteroItems)
			}
		})
		.catch((e) => {
			logAppend(e)
		})
}

// hypothesisNotes: zoteroItems that are child notes from hypothesis
// zoteroItems: zoteroItems that are not child notes from hypothesis
function processZoteroItems(hypothesisNotes, zoteroItems) {
	logAppend(`zotero items that could be annotated: ${zoteroItems.length}`)
	// spawn a worker to fetch hypothesis annotations for zotero items
	const annotationFetcher = new Worker('fetchAnnotations.js')

	const annotationFetchResults = {}

	// listen for messages from the annotation fetcher
	annotationFetcher.addEventListener('message', function(e) {
		annotationFetchResults[e.data.key] = e.data
		let fetchedCount = Object.keys(annotationFetchResults).length
		//logWrite(`fetchWorker got response #${fetchedCount} of ${zoteroItems.length} expected`)
		// expect as many messages as zotero items, if fewer, the app will time out
		if (fetchedCount == zoteroItems.length) {
			//logAppend(`all ${fetchedCount} messages received from annotation fetcher, calling importer`)
			annotationFetcher.terminate()

			// get the ids of imported hypothesis notes
			let excludedIds = hypothesisNotes.map((x) => {
				let id = 'NoHypothesisId'
				x.tags.forEach((tag) => {
					if (isHypothesisTag(tag)) {
						id = getHypothesisIdFromZoteroTag(tag)
					}
				})
				return id
			})

			let resultsToImport = []

			const zoteroKeys = Object.keys(annotationFetchResults)
			for (let i = 0; i < zoteroKeys.length; i++) {
				const fetchedResultForZoteroKey = annotationFetchResults[zoteroKeys[i]]
				if (fetchedResultForZoteroKey.hypothesisTotal == 0) {
					continue
				}
				let candidateAnnos = fetchedResultForZoteroKey.hypothesisAnnos
				// exclude replies
				candidateAnnos = candidateAnnos.filter((x) => {
					return !x.references
				})
				// filter out the excluded rows
				const importAnnos = candidateAnnos.filter((x) => {
					return excludedIds.indexOf(x.id) == -1
				})
				fetchedResultForZoteroKey.hypothesisAnnos = importAnnos
				if (importAnnos.length) {
					resultsToImport.push(fetchedResultForZoteroKey)
				}
			}
			logAppend(`zotero items with new annotations to import: ${resultsToImport.length}`)
			if (resultsToImport.length) {
				importer(resultsToImport)
			}
		}
	})

	// message the worker once per zotero item
	zoteroItems.forEach(function(zoteroItem) {
		annotationFetcher.postMessage({
			zoteroItem: zoteroItem,
			token: hlib.getToken() // hypothesis api token so worker can read private/group annotations
		})
	})
}

function getHypothesisIdFromZoteroTag(tag) {
	return tag['tag'].slice(11)
}
function isHypothesisTag(tag) {
	return tag['tag'].slice(0, 11) === 'hypothesis-'
}

function hasHypothesisTag(zoteroItem) {
	let hasHypothesisTag = false
	zoteroItem.tags.forEach((tag) => {
		if (isHypothesisTag(tag)) {
			hasHypothesisTag = true
		}
	})
	return hasHypothesisTag
}

// called with a list of objects that contain a merge of zotero item info
// and hypothesis api search results
function importer(resultsToImport) {
  const importWorker = new Worker('postNotes.js')
  const objectKeys = Object.keys(resultsToImport)

  const expectedResponses = {}

  objectKeys.forEach(key => {
    const resultToImport = resultsToImport[key]
    expectedResponses[resultToImport.key] = resultToImport.hypothesisAnnos.length
  })

	importWorker.addEventListener('message', function(e) {
		if (e.data.zoteroKey) {
			expectedResponses[e.data.zoteroKey] -= 1
		} else {
			logAppend(e.data)
    }
    let done = true
    Object.keys(expectedResponses).forEach( zoteroKey => {
      if (expectedResponses[zoteroKey]) {
        done = false
      }
    })
		if (done) {
			logAppend('done')
			importWorker.terminate()
		}
	})

	objectKeys.forEach(function(key) {
		// ask the worker to import annotations for a zotero item
		importWorker.postMessage({
			zoteroUserId: getZoteroUserId(),
			zoteroApiKey: getZoteroApiKey(),
			zoteroItemKey: key,
			annotationsToImport: resultsToImport[key]
		})
	})
}

const tokenContainer = hlib.getById('tokenContainer')
hlib.createApiTokenInputForm(tokenContainer)

const userArgs = {
	element: hlib.getById('zoteroUserContainer'),
	name: 'Zotero numeric user ID',
	id: 'zoteroUserId',
	value: getZoteroUserId(),
	onchange: setZoteroUserId,
	type: '',
	msg:
		'Zotero numeric user id from <a href="https://www.zotero.org/settings/keys">https://www.zotero.org/settings/keys</a>'
}

hlib.createNamedInputForm(userArgs)

const apiKeyArgs = {
	element: hlib.getById('zoteroApiKeyContainer'),
	name: 'Zotero API key',
	id: 'zoteroApiKey',
	value: getZoteroApiKey(),
	onchange: setZoteroApiKey,
	type: 'password',
	msg: 'Zotero API key from <a href="https://www.zotero.org/settings/keys">https://www.zotero.org/settings/keys</a>'
}

hlib.createNamedInputForm(apiKeyArgs)

const viewer = document.getElementById('viewer')
