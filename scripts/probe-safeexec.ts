import { SafeExec } from '../src/main/safe-exec'
const exec = new SafeExec()
const run = async () => {
  console.log('Finder running:', await exec.script('app.running', ['com.apple.finder']))
  console.log(
    'Nonexistent running:',
    await exec.script('app.running', ['com.example.doesnotexist']),
  )
  const front = await exec.run('lsappinfo', ['front'])
  console.log('lsappinfo front:', front.stdout.trim())
}
run().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})
