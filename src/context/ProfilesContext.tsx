import { createContext, useContext } from "react";
import type { Profile } from "../lib/sidecarApi";

export type ProfilesValue = {
  profiles: Profile[];
  activeProfileId: string | null;
  activeProfileName: string | null;
  refresh: () => Promise<void>;
  switchTo: (profileId: string) => Promise<void>;
};

export const ProfilesContext = createContext<ProfilesValue>({
  profiles: [],
  activeProfileId: null,
  activeProfileName: null,
  refresh: async () => {},
  switchTo: async () => {},
});

export function useProfiles() {
  return useContext(ProfilesContext);
}

