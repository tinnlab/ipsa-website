import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';

const GlobalSettingsContext = createContext();

export const useGlobalSettings = () => {
  const context = useContext(GlobalSettingsContext);
  if (!context) {
    throw new Error('useGlobalSettings must be used within GlobalSettingsProvider');
  }
  return context;
};

export const GlobalSettingsProvider = ({ children, sessionId }) => {
  // Default settings
  const defaultSettings = {
    pValueFDR: 0.05,
    pValue: 0.05,
    foldChange: 1.0,
    enrichmentScore: 1.5
  };

  // Subscribe to session and get global settings from database.
  // readOnly lives on the same document, so it is surfaced from the same tracker. This provider
  // already wraps the entire Visualization page, which makes it the one place every descendant can
  // read the flag from without prop drilling.
  const {globalSettings: storedSettings, readOnly} = useTracker(() => {
    if (!sessionId) return {globalSettings: defaultSettings, readOnly: false};

    const handle = Meteor.subscribe('analysis.session', sessionId);
    if (!handle.ready()) return {globalSettings: defaultSettings, readOnly: false};

    const session = DBCollections.Session.findOne({_id: sessionId});
    return {
      globalSettings: session?.globalSettings || defaultSettings,
      // Defaults to false while the subscription is still loading. That is safe: the server
      // rejects every mutation on a read-only study regardless, so a brief window of un-hidden
      // controls cannot produce a write — hiding them is a UX affordance, not the control.
      readOnly: session?.readOnly === true,
    };
  }, [sessionId]);

  // Settings applied locally on a view-only study. Every chart reads `globalSettings`, so a
  // read-only Apply cannot simply skip the write and leave tempSettings to do the work —
  // tempSettings is consumed only by the settings panel itself, so nothing would have changed and
  // Apply would look broken. Instead the applied values are held here and served AS
  // globalSettings, which makes the plots retune exactly as they do for an owner while nothing is
  // persisted. null until the recipient applies something, so the study's own values show first.
  const [locallyApplied, setLocallyApplied] = useState(null);

  const globalSettings = (readOnly && locallyApplied) ? locallyApplied : storedSettings;

  // Temporary settings being edited (before Apply)
  const [tempSettings, setTempSettings] = useState({...globalSettings});

  // Sync temp settings when global settings change from database
  useEffect(() => {
    setTempSettings({...globalSettings});
  }, [globalSettings]);

  // Apply temporary settings to database — or, on a view-only imported study, to local state only.
  // The server rejects the write there anyway; committing locally keeps the control working
  // (retune and export) without persisting, which is what the page's banner promises.
  const applySettings = async () => {
    if (readOnly) {
      setLocallyApplied({...tempSettings});
      return;
    }
    try {
      await Meteor.callAsync('session.updateGlobalSettings', {
        sessionId,
        settings: tempSettings
      });
    } catch (error) {
      console.error('Error updating global settings:', error);
    }
  };

  // Reset temporary to global. On a read-only study this also drops any locally applied values, so
  // Reset returns the plots to the study as it was shared.
  const resetSettings = () => {
    if (readOnly) setLocallyApplied(null);
    setTempSettings({...storedSettings});
  };

  return (
    <GlobalSettingsContext.Provider value={{
      globalSettings,
      tempSettings,
      setTempSettings,
      applySettings,
      resetSettings,
      readOnly
    }}>
      {children}
    </GlobalSettingsContext.Provider>
  );
};
