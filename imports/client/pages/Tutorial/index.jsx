import React from 'react';
import TutorialEmbed from './TutorialEmbed';

import "./index.style.less"
const TutorialPage = () => {
  return (
    <div className="tutorial-page" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <TutorialEmbed />
      </div>
    </div>
  );
};

export default TutorialPage;