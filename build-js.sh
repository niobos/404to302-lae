#!/usr/bin/env bash

set -o errexit
set -o pipefail
set -o nounset
#set -o xtrace

# Option parsing & usage info
SRC_DIR="src"
OUT_FILE="build.zip"
unset HASH_FILE
KEEP=""

usage() {
  cat - <<EOHELP
USAGE:
  $0 <options>

OPTIONS:
    -h, --help                This help message.
    -s, --source <dir>        Source directory to process. Default: \`${SRC_DIR}\`
    -d, --dest <zipfile>      Output location of ZIP-file. Default: \`${OUT_FILE}\`
    --hash[=<file>]           Output a (reproducible) hash of the content.
                              Optionally write it to the given file.
                              Default: off
    -k, --keep                Keep build directory.

EOHELP
}

## getopt parsing
if getopt -T >/dev/null 2>&1; [ $? == 4 ]; then
    : # Enhanced getopt.
else
    echo "Could not find an enhanced \`getopt\`. You have $(getopt -V)"
    exit 69 # EX_UNAVAILABLE
fi

if GETOPT_TEMP="$( getopt -o hs:d:k --long help,source:,dest:,hash::,keep -n "$0" -- "$@" )"; then
    eval set -- "${GETOPT_TEMP}"
else
    usage >&2
    exit 64  # EX_USAGE
fi

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)     usage; exit 0;;
    -s|--source)   SRC_DIR=$2; shift;;
    -d|--dest)     OUT_FILE=$2; shift;;
    --hash)        HASH_FILE=$2; shift;;   # $2 will be either the param, or the empty string if none is specified
    -k|--keep)     KEEP=1;;
    --)            shift; break;;
    *)             break;;
  esac;
  shift;
done

if [ $# -gt 0 ]; then
    usage >&2
    exit 64 # EX_USAGE
fi


# EXIT-hooks are ideal to clean up when things go wrong
# Especially useful with `set -o errexit`, which can exit at unexpected locations
# usage:
#    add_on_exit "rm -rf /tmp/directory"  # Add command to the list to execute at exit
#    prepend_on_exit "unmount /mnt/bla"   # Add command at the top of the list (i.e. execute in reverse order of adding)
on_exit_items=()
on_exit() {
    for i in "${on_exit_items[@]}"; do
        eval $i
    done
}
add_on_exit() {
    local n=${#on_exit_items[*]}
    on_exit_items[$n]="$*"
    if [[ $n -eq 0 ]]; then
        trap on_exit EXIT
    fi
}
prepend_on_exit() {
    local n=${#on_exit_items[*]}
    if [[ $n -eq 0 ]]; then
        on_exit_items=("$*")
        trap on_exit EXIT
    else
        on_exit_items=("$*" "${on_exit_items[@]}")
    fi
}


make_absolute() {
    if [ -z "${1}" ]; then
        return
    fi
    case "${1}" in
        /*) echo "${1}";;  # already absolute path
        *)  echo "${PWD}/${1}";;
    esac
}

OUT_FILE="$( make_absolute "${OUT_FILE}" )"
if [ -n "${HASH_FILE-}" ]; then
    # HASH_FILE is set and non-empty
    HASH_FILE="$( make_absolute "${HASH_FILE}" )"
fi

BUILD_DIR=`mktemp -d 2>/dev/null || mktemp -d -t 'build'`  # Linux & BSD-compatible
if [ -z "$KEEP" ]; then
    add_on_exit "rm -rf \"${BUILD_DIR}\""
fi

cp -a "${SRC_DIR}/" "${BUILD_DIR}"
cp package.json "${BUILD_DIR}/."

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  (
    echo "HEAD is at $(git rev-parse HEAD)"
    echo "Status:"
    git status --porcelain
  ) > "${BUILD_DIR}/build.log"
fi

(
    cd "${BUILD_DIR}"
    npm install --production

    if [ -d node_modules ]; then
      echo "Stripping build path from \`package.json\`"
      find node_modules -name package.json | while read package_json; do
        echo "    ${package_json}"
        jq 'del(.["_args", "_where"])' < "${package_json}" > "${package_json}.tmp" && \
          mv "${package_json}.tmp" "${package_json}"
      done
    fi

    if [ -n "${HASH_FILE+set}" ]; then
        git init -q
        git add --all
        git rm --cached "build.log"
        git commit --no-gpg-sign -qm 'whatever'
        HASH=`git cat-file -p HEAD | grep '^tree' | awk '{print $2}'`
        rm -rf .git
    fi

    # make sure the file is empty. Zip will *add* if the file exists
    rm -f "${OUT_FILE}"
    zip "${OUT_FILE}" -r .

    if [ -n "${HASH_FILE+set}" ]; then
        echo "Content hash: ${HASH}"
        if [ -n "${HASH_FILE-}" ]; then
            echo "${HASH}" > "${HASH_FILE}"
        fi
    fi
)

if [ -n "$KEEP" ]; then
    echo "Build dir left intact at \`${BUILD_DIR}\`"
fi
