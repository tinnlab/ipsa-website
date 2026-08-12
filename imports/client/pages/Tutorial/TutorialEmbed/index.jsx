import React, { useState, useEffect, useRef } from 'react';
import { setCookie } from '../../../utils/cookieManager';

const TutorialEmbed = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [iframeReady, setIframeReady] = useState(false);
  const iframeRef = useRef(null);

  useEffect(() => {
    const setCookieAndPrepareIframe = async () => {
      try {
        // Set the cookie (only if user has consented)
        const cookieSet = setCookie('wh_theme', 'light', { path: '/' });

        if (!cookieSet) {
          console.warn('Cookie consent not given. Tutorial may load in dark mode.');
        }

        // Wait a bit to ensure the cookie is set
        await new Promise(resolve => setTimeout(resolve, 100));

        // Mark iframe as ready to load
        setIframeReady(true);
      } catch (err) {
        console.error('Error setting cookie:', err);
        setError('Failed to set theme preference. The tutorial may load in dark mode.');
      } finally {
        setLoading(false);
      }
    };

    setCookieAndPrepareIframe();

    const handleResize = () => {
      if (iframeRef.current) {
        iframeRef.current.style.height = `${window.innerHeight}px`;
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Set initial height

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleIframeLoad = () => {
    setLoading(false);
  };

  const handleIframeError = () => {
    setError('Failed to load the tutorial content. Make sure the tutorial site has been mounted at /tutorial.');
    setLoading(false);
  };

  return (
    <div className="tutorial-embed" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {loading && <div>Preparing tutorial content...</div>}
      {error && <div className="error">{error}</div>}
      {iframeReady && (
        <iframe
          ref={iframeRef}
          src="/tutorial/"
          width="100%"
          height="100%"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          style={{
            border: 'none',
            flex: 1
          }}
        />
      )}
    </div>
  );
};

export default TutorialEmbed;