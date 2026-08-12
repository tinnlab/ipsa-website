import React, { useEffect, useMemo, useRef, useState } from 'react';
import isEqual from 'react-fast-compare';

const InViewRender = (Component) => {
  return (props) => {
    const ref = useRef(null);
    const [shouldRender, setShouldRender] = useState(false);
    const [count, setCount] = useState(0);
    const prevProps = useRef(props);

    useEffect(() => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setShouldRender(true);
            // Once the component is rendered, we don't need to observe anymore
            observer.unobserve(entry.target);
          }
        },
        {
          root: null,
          rootMargin: '1800px', // This will create a 400px margin around the viewport
          threshold: 0,
        }
      );

      if (ref.current) {
        observer.observe(ref.current);
      }

      return () => {
        if (ref.current) {
          observer.unobserve(ref.current);
        }
      };
    }, []);

    useEffect(() => {
      if (shouldRender && !isEqual(props, prevProps.current)) {
        prevProps.current = props;
        setCount((prevCount) => prevCount + 1);
      }
    }, [shouldRender, props]);

    const component = useMemo(() => {
      return shouldRender ? <Component {...props} /> : null;
    }, [shouldRender, count]);

    return (
      <>
        <div ref={ref} style={{ width: 0, height: 0 }} />
        {component}
      </>
    );
  };
};

export default InViewRender;