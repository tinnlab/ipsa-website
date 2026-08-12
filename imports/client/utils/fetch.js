const { Mutex } = require('async-mutex');
const { authHeaders } = require('./authHeaders');

const fetchingMutex = new Map();

// fetch but with queue to avoid multiple requests to the same url
const fetch2 = async (url) => {
  let mutex = fetchingMutex.get(url);
  if (!mutex) {
    mutex = new Mutex();
    fetchingMutex.set(url, mutex);
  }

  const release = await mutex.acquire();
  try {
    // Identify the caller so the endpoint can check study ownership; see ./authHeaders.
    // Requests without a valid token are answered 401.
    return await fetch(url, {headers: authHeaders()});
  } finally {
    release();
    setTimeout(() => {
      fetchingMutex.delete(url);
    }, 10000);
  }
};

module.exports = fetch2;