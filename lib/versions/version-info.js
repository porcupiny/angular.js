var fs = require('fs');
var path = require('path');
var shell = require('shelljs');
var semver = require('semver');
var _ = require('lodash');

var currentPackage, previousVersions;


/**
 * Load information about this project from the package.json
 * @return {Object} The package information
 */
var getPackage = function() {
  // Search up the folder hierarchy for the first package.json
  var packageFolder = path.resolve('.');
  while ( !fs.existsSync(path.join(packageFolder, 'package.json')) ) {
    var parent = path.dirname(packageFolder);
    if ( parent === packageFolder) { break; }
    packageFolder = parent;
  }
  return JSON.parse(fs.readFileSync(path.join(packageFolder,'package.json'), 'UTF-8'));
};


/**
 * Parse the github URL for useful information
 * @return {Object} An object containing the github owner and repository name
 */
var getGitRepoInfo = function() {
  var GITURL_REGEX = /^https:\/\/github.com\/([^\/]+)\/(.+).git$/;
  var match = GITURL_REGEX.exec(currentPackage.repository.url);
  var git = {
    owner: match[1],
    repo: match[2]
  };
  return git;
};



/**
 * Extract the code name from the tagged commit's message - it should contain the text of the form:
 * "codename(some-code-name)"
 * @param  {String} tagName Name of the tag to look in for the codename
 * @return {String}         The codename if found, otherwise null/undefined
 */
var getCodeName = function(tagName) {
  var tagMessage = shell.exec('git cat-file -p '+ tagName +' | grep "codename"', {silent:true}).output;
  var codeName = tagMessage && tagMessage.match(/codename\((.*)\)/)[1];
  if (!codeName) {
    throw new Error("Could not extract release code name. The message of tag "+tagName+
      " must match '*codename(some release name)*'");
  }
  return codeName;
};


/**
 * Compute a build segment for the version, from the Jenkins build number and current commit SHA
 * @return {String} The build segment of the version
 */
function getBuild() {
  var hash = shell.exec('git rev-parse --short HEAD', {silent: true}).output.replace('\n', '');
  return 'sha.'+hash;
}


/**
 * If the current commit is tagged as a version get that version
 * @return {SemVer} The version or null
 */
var getTaggedVersion = function() {
  var gitTagResult = shell.exec('git describe --exact-match', {silent:true});

  if ( gitTagResult.code === 0 ) {
    var tag = gitTagResult.output;
    var version = semver.parse(tag);
    if ( version ) {
      if ( version.satisfies(currentPackage.branchVersion) ) {
        version.codeName = getCodeName(tag);
      }
      version.full = version.version + '+' + version.build;
      return version;
    }
  }
};

/**
 * Stable versions have an even minor version and have no prerelease
 * @param  {SemVer}  version The version to test
 * @return {Boolean}         True if the version is stable
 */
var isStable = function(version) {
  return semver.satisfies(version, '1.0 || 1.2') && version.prerelease.length === 0;
};

/**
 * Get a collection of all the previous versions sorted by semantic version
 * @return {Array.<SemVer>} The collection of previous versions
 */
var getPreviousVersions =  function() {
  var tagResults = shell.exec('git tag', {silent: true});
  if ( tagResults.code === 0 ) {
    return _(tagResults.output.trim().split('\n'))
      .map(function(tag) {
        var version = semver.parse(tag);
        return version;
      })
      .filter()
      .map(function(version) {
        version.isStable = isStable(version);

        version.docsUrl = 'http://code.angularjs.org/' + version.version + '/docs';
        // Versions before 1.0.2 had a different docs folder name
        if ( version.major < 1 || (version.major === 1 && version.minor === 0 && version.dot < 2 ) ) {
          version.docsUrl += '-' + version.version;
        }
        return version;
      })
      .sort(semver.compare)
      .value();
  }
};


/**
 * Get the unstable snapshot version
 * @return {SemVer} The snapshot version
 */
var getSnapshotVersion = function() {

  version = _(previousVersions)
    .filter(function(tag) {
      return semver.satisfies(tag, currentPackage.branchVersion);
    })
    .last();

  // We need to clone to ensure that we are not modifying another version
  version = semver(version.raw);

  var jenkinsBuild = process.env.TRAVIS_BUILD_NUMBER || process.env.BUILD_NUMBER;
  version.prerelease = jenkinsBuild ? ['build', jenkinsBuild] : ['local'];
  version.build = getBuild();
  version.codeName = 'snapshot';
  version.isSnapshot = true;
  version.format();
  version.full = version.version + '+' + version.build;

  return version;
};


exports.currentPackage = currentPackage = getPackage();
exports.previousVersions = previousVersions = getPreviousVersions();
exports.currentVersion = getTaggedVersion() || getSnapshotVersion();
exports.gitRepoInfo = getGitRepoInfo();
