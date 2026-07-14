#!/bin/bash
cd /home/nuc/bonenteller || exit 1
if [ -n "$(git status --porcelain)" ]; then
    git add .
    git commit -m "."
    git push
fi
