import React, { useState } from 'react';

const languages = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
];

interface ProfileSetupProps {
  onProfileComplete: (language: string, voiceId: string) => void;
}

const ProfileSetup: React.FC<ProfileSetupProps> = ({ onProfileComplete }) => {
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [userVoiceId, setUserVoiceId] = useState<string | null>(null);

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedLanguage(e.target.value);
  };

  const handleVoiceClone = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const formData = new FormData();
      formData.append('voiceSample', file);
      const response = await fetch('http://localhost:3001/clone-voice', {
        method: 'POST',
        body: formData
      });
      if (response.ok) {
        const { voiceId } = await response.json();
        setUserVoiceId(voiceId);
      } else {
        console.error('Failed to clone voice');
      }
    }
  };

  const handleSubmit = () => {
    if (userVoiceId) {
      onProfileComplete(selectedLanguage, userVoiceId);
    } else {
      alert('Please clone your voice before proceeding.');
    }
  };

  return (
    <div className="text-neutral-400 dark:text-neutral-600 pt-4 text-center max-w-xl text-balance min-h-28 space-y-4">
      <h2>Set Up Your Profile</h2>
      <div>
        <label htmlFor="language-select">Select your language: </label>
        <select id="language-select" value={selectedLanguage} onChange={handleLanguageChange}>
          {languages.map(lang => (
            <option key={lang.code} value={lang.code}>{lang.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="voice-clone">Clone your voice: </label>
        <input type="file" id="voice-clone" accept="audio/*" onChange={handleVoiceClone} />
        {userVoiceId && <p>Voice ID: {userVoiceId}</p>}
      </div>
      <button onClick={handleSubmit} disabled={!userVoiceId}>Start Call</button>
    </div>
  );
};

export default ProfileSetup;
