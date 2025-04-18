# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from marionette_harness import BaseMarionetteArguments


class FirefoxUIBaseArguments:
    name = "Firefox UI Tests"
    args = []


class FirefoxUIArguments(BaseMarionetteArguments):
    def __init__(self, **kwargs):
        super(FirefoxUIArguments, self).__init__(**kwargs)

        self.register_argument_container(FirefoxUIBaseArguments())
