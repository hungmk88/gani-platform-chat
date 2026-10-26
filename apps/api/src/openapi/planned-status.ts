/**
 * What marks a path of the planned document (planned.ts): not served yet, and the sprint it is built in (Brief §11). The front end
 * may build its screens on it; the shape holds when the path moves to the served document.
 */
export const planned = (sprint: string) => ({ 'x-status': 'planned', 'x-sprint': sprint }) as const;
