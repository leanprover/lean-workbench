import Link from 'next/link'

export default function ProjectLink({ ownerUsername, projectName }: { ownerUsername: string; projectName: string }) {
  return (
    <>
      <Link href={`/${ownerUsername}`}>{ownerUsername}</Link>
      <span style={{ color: '#90a4ae', margin: '0 0.25rem' }}>/</span>
      <Link href={`/${ownerUsername}/${projectName}`}>{projectName}</Link>
    </>
  )
}
