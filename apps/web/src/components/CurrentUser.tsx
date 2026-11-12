import { roleCan, type Permission, type Role } from '@local-chatter/shared';
import { createContext, useContext } from 'react';

/** The person who is logged in */
export interface CurrentUser {
  username: string;
  role: Role;
}

/** The login gate sets it */
export const CurrentUserContext = createContext<CurrentUser | null>(null);

export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext);
}

/**
 * True when the role of the user can do this. Use it to hide what the user cannot do.
 * The server checks the role again on each request.
 */
export function useCan(permission: Permission): boolean {
  const user = useCurrentUser();
  return user !== null && roleCan(user.role, permission);
}
