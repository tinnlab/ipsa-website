const { Mutex } = require('async-mutex');

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
    return await fetch(url);
  } finally {
    release();
    setTimeout(() => {
      fetchingMutex.delete(url);
    }, 10000);
  }
};

module.exports = fetch2;