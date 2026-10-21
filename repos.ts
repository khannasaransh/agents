// The Repo list: every company Repo the Pipeline watches, shared with machine setup.
// Left out on purpose: personal repos, repos without a remote, the Flutter SDK clone, autopay-android.
//
// The production branch is the remote's default branch as each clone recorded it (origin/HEAD),
// except where noted. Folders are where the clones live on this Mac; on a new machine a Repo is
// cloned into a folder named for its Team.
import type { Repo } from './src/repos.ts'

const repos: Repo[] = [
  // flutter
  { name: 'crux_flutter', team: 'flutter', remote: 'https://github.com/NewsInShorts/crux_flutter.git', folder: '~/Saransh/flutter/crux_flutter', branch: 'main' },
  { name: 'customcard_flutter', team: 'flutter', remote: 'https://github.com/NewsInShorts/customcard_flutter.git', folder: '~/Saransh/flutter/customcard_flutter', branch: 'development' },
  // Exception named in the PRD: production is main.
  { name: 'flutter_payment', team: 'flutter', remote: 'https://github.com/NewsInShorts/flutter_payment.git', folder: '~/Saransh/flutter/flutter_payment', branch: 'main' },
  { name: 'inpix_flutter', team: 'flutter', remote: 'git@github.com:NewsInShorts/inpix_flutter.git', folder: '~/Saransh/flutter/inpix_flutter', branch: 'development' },
  // Exception named in the PRD: production is main.
  { name: 'skill-up', team: 'flutter', remote: 'https://github.com/NewsInShorts/skill-up.git', folder: '~/Saransh/flutter/skill-up', branch: 'main' },
  { name: 'tangy_tv_flutter', team: 'flutter', remote: 'https://github.com/NewsInShorts/tangy_tv_flutter.git', folder: '~/Saransh/flutter/tangy_tv_flutter', branch: 'development' },

  // android
  { name: 'Public-Messenger-Module', team: 'android', remote: 'https://github.com/NewsInShorts/Public-Messenger-Module.git', folder: '~/Saransh/android/Public-Messenger-Module', branch: 'main' },
  { name: 'android-core-dependencies', team: 'android', remote: 'https://github.com/NewsInShorts/android-core-dependencies.git', folder: '~/Saransh/android/android-core-dependencies', branch: 'main' },
  { name: 'autopay-alerts-android', team: 'android', remote: 'https://github.com/NewsInShorts/autopay-alerts-android.git', folder: '~/Saransh/android/autopay-alerts-android', branch: 'main' },
  { name: 'drama-android', team: 'android', remote: 'https://github.com/NewsInShorts/drama-android.git', folder: '~/Saransh/android/drama-android', branch: 'main' },
  // Exception named in the PRD: production is master.
  { name: 'inshortsapp', team: 'android', remote: 'https://github.com/NewsInShorts/inshortsapp.git', folder: '~/Saransh/android/inshortsapp', branch: 'master' },
  { name: 'video-shorts', team: 'android', remote: 'https://github.com/NewsInShorts/video-shorts.git', folder: '~/Saransh/android/video-shorts', branch: 'master' },

  // ios
  { name: 'inshortsapp_swift_uikit', team: 'ios', remote: 'https://github.com/NewsInShorts/inshortsapp_swift_uikit.git', folder: '~/Saransh/ios/inshortsapp_swift_uikit', branch: 'main' },

  // backend
  { name: 'inpix-parse-service', team: 'backend', remote: 'https://github.com/NewsInShorts/inpix-parse-service', folder: '~/Saransh/backend/inpix-parse-service', branch: 'master' },
  { name: 'inpix-read-service', team: 'backend', remote: 'https://github.com/NewsInShorts/inpix-read-service.git', folder: '~/Saransh/backend/inpix-read-service', branch: 'main' },
  { name: 'inpix-user-service', team: 'backend', remote: 'https://github.com/NewsInShorts/inpix-user-service', folder: '~/Saransh/backend/inpix-user-service', branch: 'ind-production' },
  { name: 'inpix-write-service', team: 'backend', remote: 'https://github.com/NewsInShorts/inpix-write-service', folder: '~/Saransh/backend/inpix-write-service', branch: 'ind-production' },
  { name: 'inshorts-write-go', team: 'backend', remote: 'https://github.com/NewsInShorts/inshorts-write-go.git', folder: '~/Saransh/backend/inshorts-write-go', branch: 'main' },
  { name: 'news-read-go', team: 'backend', remote: 'https://github.com/NewsInShorts/news-read-go.git', folder: '~/Saransh/backend/news-read-go', branch: 'master' },
  { name: 'nis-payments-platform', team: 'backend', remote: 'https://github.com/NewsInShorts/nis-payments-platform', folder: '~/Saransh/backend/nis-payments-platform', branch: 'master' },
  { name: 'nis-payments-service', team: 'backend', remote: 'https://github.com/NewsInShorts/nis-payments-service', folder: '~/Saransh/backend/nis-payments-service', branch: 'master' },
  { name: 'nis-search-go', team: 'backend', remote: 'https://github.com/NewsInShorts/nis-search-go.git', folder: '~/Saransh/backend/nis-search-go', branch: 'ind-production' },

  // data (cloned under backend on this Mac)
  { name: 'inpix-analytics', team: 'data', remote: 'https://github.com/NewsInShorts/inpix-analytics.git', folder: '~/Saransh/backend/inpix-analytics', branch: 'master' },
  { name: 'inpix-recommendation', team: 'data', remote: 'https://github.com/NewsInShorts/inpix-recommendation.git', folder: '~/Saransh/backend/inpix-recommendation', branch: 'main' },
  { name: 'inpix-share-dashboard', team: 'data', remote: 'https://github.com/NewsInShorts/inpix-share-dashboard.git', folder: '~/Saransh/backend/inpix-share-dashboard', branch: 'main' },

  // frontend
  { name: 'cards-autogen', team: 'frontend', remote: 'https://github.com/NewsInShorts/cards-autogen.git', folder: '~/Saransh/frontend/cards-autogen', branch: 'main' },
  { name: 'inpix-panel', team: 'frontend', remote: 'https://github.com/NewsInShorts/inpix-panel.git', folder: '~/Saransh/frontend/inpix-panel', branch: 'main' },
  { name: 'inpix-website', team: 'frontend', remote: 'https://github.com/NewsInShorts/inpix-website.git', folder: '~/Saransh/frontend/inpix-website', branch: 'main' },
  { name: 'video-shorts-webapp', team: 'frontend', remote: 'https://github.com/NewsInShorts/video-shorts-webapp', folder: '~/Saransh/frontend/video-shorts-webapp', branch: 'main' },
]

export default repos
