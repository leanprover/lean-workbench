/* Bubblewrapping operations should almost certainly, long term, be the purview of the shard
 * manager, but in the short term, publication infrastructure also needs it.
 */

/** Arguments that we pass to every bubblewrap sandbox before any other arguments. */
export const BWRAP_ARGS =
  /* prettier-ignore */ [
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind-try', '/lib64', '/lib64',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/etc', '/etc',
    // TeX format files
    '--ro-bind', '/var/lib/texmf', '/var/lib/texmf',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--unshare-user',
    '--uid', '1000',
    '--gid', '1000',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-cgroup',
    '--unshare-ipc',
    // TODO(security): unshare-net but allow outgoing inet connections for VSC bwraps.
    // https://github.com/containers/bubblewrap/issues/504
    // https://github.com/rootless-containers/slirp4netns
    '--die-with-parent',
    '--new-session',
    '--clearenv',
    // Override the locale with one that is always present
    '--setenv', 'LC_ALL', 'C.UTF-8',
  ]

/** Where bwrap mounts the given user's home directory. */
export function bwrapHomeDir(userName: string) {
  return `/home/${userName}/`
}
