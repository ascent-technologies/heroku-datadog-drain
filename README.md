# Heroku Datadog Drain

Funnel metrics from multiple Heroku apps into DataDog using statsd.


Supported Heroku metrics:
- Heroku Router response times, status codes, etc.
- Application errors
- Heroku Postgres metrics
- Heroku Dyno [runtime metrics](https://devcenter.heroku.com/articles/log-runtime-metrics)

## Get Started
```bash
git clone git@github.com:ozinc/heroku-datadog-drain.git
cd heroku-datadog-drain

# Create the Heroku instance
heroku apps:create <this-log-drain-app-slug> --buildpack=heroku/nodejs

# Set the initial Heroku instance config for you for app, with the env var key as uppercase
heroku config:set ALLOWED_APPS=<your-app-slug> <YOUR-APP-SLUG>_PASSWORD=<password>

# Add the buildpack to include the datadog agent
heroku buildpacks:add --index 1 https://github.com/DataDog/heroku-buildpack-datadog.git

# Add the datadog api key
heroku config:add DD_API_KEY=<DATADOG_API_KEY>

# Push this code to heroku master
git push heroku master

# Scale the heroku instance with resources.
heroku ps:scale web=1

# Add the drain
heroku drains:add https://<your-app-slug>:<password>@<this-log-drain-app-slug>.herokuapp.com/ --app <your-app-slug>
```

## Add a new drain

If you already have an heroku app for DataDog then you only need to run the
following commands to add a new drain:

```bash
# The ALLOWED_APPS var will already be configured in Heroku, so you will need to
# grab the value of this var first from Heroku and then append <your-app-slug> as another
# comma seperated value.
HEROKU_DRAIN_ALLOWED_APPS="$(heroku config:get ALLOWED_APPS --app <this-log-drain-app-slug>)"

# Check the output of the variable and confirm it is correct.
echo $HEROKU_DRAIN_ALLOWED_APPS

# The password should be a secure, randomly generated password.
# NOTE: You need to set the ALLOWED_APPS and <YOUR_APP_SLUG>_PASSWORD at the same
# time otherwise the collection for metrics of all other apps will STOP.
heroku config:set ALLOWED_APPS=$HEROKU_DRAIN_ALLOWED_APPS,<your_app_slug> <YOUR_APP_SLUG>_PASSWORD=<password> --app <this-log-drain-app-slug>

# Now you can add this drain using the credentials set above.
heroku drains:add https://<your_app_slug>:<password>@<this-log-drain-app-slug>.herokuapp.com/ --app <your-app-slug>
```

## Configuration
```bash
ALLOWED_APPS=my-app,..    # Required. Comma seperated list of app names
<APP_NAME>_PASSWORD=..    # Required. One per allowed app where <APP-NAME> corresponds to an app name from ALLOWED_APPS
<APP_NAME>_TAGS=mytag,..  # Optional. Comma seperated list of default tags for each app
<APP_NAME>_PREFIX=yee     # Optional. String to be prepended to all metrics from a given app
STATSD_URL=..             # Optional. Default: statsd://localhost:8125
DEBUG=                    # Optional. If DEBUG is set, a lot of stuff will be logged :)
```
