/**
 * Conventional Commits, matched to the tf-tools / threaditate house style.
 *
 * `scope` is encouraged and should name the unit you touched:
 *   actions/setup-node, workflows/node-ci, docs, ci, deps
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'chore',
        'refactor',
        'perf',
        'test',
        'ci',
        'build',
        'style',
        'revert',
      ],
    ],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
  },
};
