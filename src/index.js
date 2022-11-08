'use strict';

const b2Domain = 'xxxx'; // configure this as per instructions above
const b2Bucket = 'xxxx'; // configure this as per instructions above
const b2UrlPath = `/file/${b2Bucket}`;
addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method === 'POST' && url.pathname === '/upload') {
    event.passThroughOnException()
    event.respondWith(handleRequest(event.request))
  } else {
    return event.respondWith(fileReq(event));
  }
});

// define the file extensions we wish to add basic access control headers to
const corsFileTypes = ['png', 'jpg', 'gif', 'jpeg', 'webp', 'py'];

// backblaze returns some additional headers that are useful for debugging, but unnecessary in production. We can remove these to save some size
const removeHeaders = [
  'x-bz-content-sha1',
  'x-bz-file-id',
  'x-bz-file-name',
  'x-bz-info-src_last_modified_millis',
  'X-Bz-Upload-Timestamp',
  'Expires'
];
const expiration = 31536000; // override browser cache for images - 1 year

// define a function we can re-use to fix headers
const fixHeaders = function (url, status, headers) {
  let newHdrs = new Headers(headers);
  // add basic cors headers for images
  if (corsFileTypes.includes(url.pathname.split('.').pop())) {
    newHdrs.set('Access-Control-Allow-Origin', '*');
  }
  // override browser cache for files when 200
  if (status === 200) {
    newHdrs.set('Cache-Control', "public, max-age=" + expiration);
  } else {
    // only cache other things for 5 minutes
    newHdrs.set('Cache-Control', 'public, max-age=300');
  }
  // set ETag for efficient caching where possible
  const ETag = newHdrs.get('x-bz-content-sha1') || newHdrs.get('x-bz-info-src_last_modified_millis') || newHdrs.get('x-bz-file-id');
  if (ETag) {
    newHdrs.set('ETag', ETag);
  }
  // remove unnecessary headers
  removeHeaders.forEach(header => {
    newHdrs.delete(header);
  });
  return newHdrs;
};

const defaultHeader = function (status = 200) {
  let defaultHeader = {
    headers: {
      'content-type': 'application/json;charset=UTF-8',
    },
    status: status
  }
  return defaultHeader
}
async function fileReq(event) {
  const cache = caches.default; // Cloudflare edge caching
  const url = new URL(event.request.url);
  if ((url.host === b2Domain || url.host === 'localhost') && !url.pathname.startsWith(b2UrlPath)) {
    url.host = 'f004.backblazeb2.com'; // change this !!!
    url.pathname = b2UrlPath + url.pathname;
  }
  let response = await cache.match(url); // try to find match for this request in the edge cache
  if (response) {
    console.log('find cache')
    // use cache found on Cloudflare edge. Set X-Worker-Cache header for helpful debug
    let newHdrs = fixHeaders(url, response.status, response.headers);
    newHdrs.set('X-Worker-Cache', "true");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHdrs
    });
  }
  // no cache, fetch image, apply Cloudflare lossless compression
  response = await fetch(url, { cf: { polish: "lossless" } });
  let newHdrs = fixHeaders(url, response.status, response.headers);
  if (response.status === 200) {
    response = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHdrs
    });
  } else {
    response = new Response('{"error": "File not found!"}', defaultHeader(404))
  }

  event.waitUntil(cache.put(url, response.clone()));
  return response;
}


/////////////////////////
// b2 Configure these
/////////////////////////
const key = 'xxxx';
const appKey = 'xxxx';
const bucketId = 'xxx';
const bucketName = 'xxx';

const apiVer = 'b2api/v2';
const downloadBase = `https://${b2Domain}`;


// 22 hours, it lasts for 24 hours but we expire early to just avoid any auth errors
const detailsExpiration = 79200;

const initialAuth = btoa(key + ':' + appKey);

async function handleRequest(request) {
  // Only accept a POST
  if (request.method !== 'POST') {
    return new Response('{"error": "Bad request!"}', defaultHeader(400));
  }

  // Parse the request to FormData

  // Parse the request to FormData
  const formData = await request.formData();
  // Get the File from the form. Key for the file is 'image' for me
  const file = formData.get('file')
  const hash = await sha1(file);
  const fileName = await upload_kv.get(hash) || await upload(file, hash);
  if (!fileName) {
    return new Response('{"error": "Failed to upload!"}', defaultHeader(400));
  }

  return new Response(`{"message": "Uploaded!", "file": "${fileName}","downloadUrl": "${downloadBase}/${fileName}","hash": "${hash}"}`, defaultHeader());
}

// returns: { "apiUrl", "authToken", "bucketAuth", "uploadUrl" }
async function setup() {
  // We will try and fetch the auth token and upload URL from KV.
  // They are valid for 24 hours so no need to request it every time
  // { "apiUrl", "authToken", "bucketAuth", "uploadUrl" }
  const storedDetails = await upload_kv.get('details', 'json');

  if (storedDetails) {
    return storedDetails;
  }

  // If we are not authorized then let's do that!
  const details = {};

  const authRes = await fetch(`https://api.backblazeb2.com/${apiVer}/b2_authorize_account`, {
    headers: {
      Authorization: 'Basic ' + initialAuth
    }
  });
  const authJson = await authRes.json();

  if (!authRes.ok) {
    console.error('Failed to authenticate, got json:', authJson);
    return false;
  }

  // Grab the auth token from the responses
  details.apiUrl = authJson.apiUrl;
  details.authToken = authJson.authorizationToken;

  // Grab the upload URL
  const uploadRes = await fetch(`${authJson.apiUrl}/${apiVer}/b2_get_upload_url`, {
    method: 'POST',
    headers: {
      Authorization: authJson.authorizationToken
    },
    body: JSON.stringify({
      bucketId
    })
  });
  const uploadJson = await uploadRes.json();

  if (!uploadRes.ok) {
    console.error('Failed to get upload URL, got json:', uploadJson);
    return false;
  }

  details.bucketAuth = uploadJson.authorizationToken;
  details.uploadUrl = uploadJson.uploadUrl;

  // Write the details into KV so we can get them in future calls.
  // Note this can take up to 60 seconds to propagate globally.
  await upload_kv.put('details', JSON.stringify(details), { expirationTtl: detailsExpiration });

  return details;
}

async function upload(file, hash) {

  const details = await setup();
  if (!details) {
    return new Response('{"error": "Failed to upload!"}', defaultHeader(400));
  }

  const extension = file.name.substring(file.name.lastIndexOf('.'));

  // I'm gonna use UUIDs for files here but you could use anything
  const uploadedFileName = crypto.randomUUID() + extension;

  const res = await fetch(details.uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': details.bucketAuth,
      'X-Bz-File-Name': uploadedFileName,
      // We have the type and size of the image in File
      'Content-Type': file.type,
      'Content-Length': file.size,
      // SHA-1 of the file
      'X-Bz-Content-Sha1': hash,
    },
    body: file.stream()
  });

  if (!res.ok) {
    const json = await res.json();
    console.error('Failed to upload, got json:', json);
    return false;
  }
  upload_kv.put(hash, uploadedFileName)
  return uploadedFileName;
}

async function sha1(file) {
  const fileData = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-1', fileData);
  const array = Array.from(new Uint8Array(digest));
  const sha1 = array.map(b => b.toString(16).padStart(2, '0')).join('')
  return sha1;
}


/**
 * readRequestBody reads in the incoming request body
 * Use await readRequestBody(..) in an async function to get the string
 * @param {Request} request the incoming request to read from
 */
async function readRequestBody(request) {
  const { headers } = request;
  const contentType = headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await request.json();
  } else if (contentType.includes('application/text')) {
    return request.text();
  } else if (contentType.includes('text/html')) {
    return request.text();
  } else if (contentType.includes('form')) {
    const formData = await request.formData();
    const body = {};
    for (const entry of formData.entries()) {
      body[entry[0]] = entry[1];
    }
    return body;
  } else {
    // Perhaps some other type of data was submitted in the form
    // like an image, or some other binary data.
    return 'a file';
  }
}

