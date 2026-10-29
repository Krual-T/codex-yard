/** CLI capability comparison shared by the browser projection and Node tools. */
export function versionAtLeast(version: string | null, major: number, minor: number, patch: number, alpha: number): boolean {
  if (version === null) return false;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version);
  if (!match) return false;
  const current = [Number(match[1]), Number(match[2]), Number(match[3])];
  const threshold = [major, minor, patch];
  for (let i = 0; i < 3; i++) if (current[i] !== threshold[i]) return current[i]! > threshold[i]!;
  if (!match[4]) return true;
  const parts = match[4].split('.');
  const minimum = ['alpha', String(alpha)];
  for (let i = 0; i < minimum.length; i++) {
    if (parts[i] === undefined) return false;
    if (parts[i] === minimum[i]) continue;
    const actualNumber = /^\d+$/.test(parts[i]!);
    const minimumNumber = /^\d+$/.test(minimum[i]!);
    if (actualNumber && minimumNumber) return Number(parts[i]) > Number(minimum[i]);
    if (actualNumber !== minimumNumber) return !actualNumber;
    return parts[i]! > minimum[i]!;
  }
  return true;
}
