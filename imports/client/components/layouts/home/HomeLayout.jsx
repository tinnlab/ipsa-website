import { Meteor } from "meteor/meteor";
import React, { useMemo, useState } from 'react';
import BaseLayout from "./BaseLayout";
import { useTracker } from "meteor/react-meteor-data";
import StudySelectionModal from "../../StudySelectionModal";
import "./HomeLayout.style.less"

const useDatabases = (isAdmin) => useTracker(() => {
  if (isAdmin) {
    Meteor.subscribe("database.all");
  }
  return DBCollections.Database.find().fetch();
}, [isAdmin]);

export default function HomeLayout(props) {
  const user = useTracker(() => Meteor.user());
  const isAdmin = user?.profile.roles.includes("admin") || false;
  const databases = useDatabases(isAdmin);

  // Modal state for study selection
  const [studyModalVisible, setStudyModalVisible] = useState(false);
  const [studyModalMode, setStudyModalMode] = useState('createAnalysis');

  // Handle menu actions
  const handleMenuAction = (action) => {
    if (action === 'createAnalysis') {
      setStudyModalMode('createAnalysis');
      setStudyModalVisible(true);
    } else if (action === 'massAnalysis') {
      setStudyModalMode('massAnalysis');
      setStudyModalVisible(true);
    }
  };

  const adminMenu = useMemo(() => {
    if (!isAdmin) return [];

    const dbChildren = databases.map(database => ({
      link: '/gene-sets/' + database?._id,
      title: database.name + (database.namespace ? ': ' + database.namespace : '')
    }));

    return [{
      link: '/admin',
      title: 'Admin',
      children: [
        { link: '/organism', title: 'Organism' },
        { link: '/gene-set', title: 'Gene Set' },
        ...dbChildren,
        { link: '/gene-info', title: 'Gene Info' },
        { link: '/id-type', title: 'ID Type' },
        { link: '/zoho', title: 'Zoho' },
        { link: '/harmonizome', title: 'Harmonizome' },
        { 
          link: '#logout', 
          title: 'Logout',
          onClick: () => {
            Meteor.logout((err) => {
              if (!err) {
                window.location.href = `${urlPrefix}/`;
              }
            });
          }
        }
      ]
    }];
  }, [isAdmin, databases]);

  const menus = useMemo(() => [
    { link: '/', title: "Home" },
    {
      link: '/analysis',
      title: "Analysis",
      children: [
        { link: '/recent-studies', title: 'Recent Studies' },
        { link: '/create-analysis', title: 'Create Analysis', action: 'createAnalysis' },
        { link: '/mass-analysis', title: 'Create Mass Analysis', action: 'massAnalysis' }
      ]
    },
    { link: '/ai-interpretation', title: "AI-interpretation" },
    { link: '/tutorial/index.html', title: "Tutorial" },
    { link: '/contact', title: "Contact" },
    ...adminMenu
  ], [adminMenu]);

  if (!user) return "Loading ...";

  return (
    <>
      <BaseLayout
        {...props}
        menus={menus}
        onMenuAction={handleMenuAction}
      />
      <StudySelectionModal
        visible={studyModalVisible}
        onClose={() => setStudyModalVisible(false)}
        mode={studyModalMode}
      />
    </>
  );
}