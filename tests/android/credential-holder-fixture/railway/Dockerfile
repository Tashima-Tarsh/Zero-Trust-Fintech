FROM ubuntu:24.04
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git openjdk-17-jdk-headless unzip && rm -rf /var/lib/apt/lists/*
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=/opt/gradle-8.11.1/bin:/opt/android-sdk/cmdline-tools/12.0/bin:$PATH
RUN curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/sdk.zip \
    && printf '%s  %s\n' 2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258 /tmp/sdk.zip | sha256sum -c - \
    && unzip -q /tmp/sdk.zip -d /tmp/sdk \
    && mkdir -p "$ANDROID_HOME/cmdline-tools" \
    && mv /tmp/sdk/cmdline-tools "$ANDROID_HOME/cmdline-tools/12.0" \
    && rm /tmp/sdk.zip \
    && (set +o pipefail; yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses >/dev/null) \
    && sdkmanager --sdk_root="$ANDROID_HOME" 'platforms;android-35' 'build-tools;35.0.0'
RUN curl -fsSL https://services.gradle.org/distributions/gradle-8.11.1-bin.zip -o /tmp/gradle.zip \
    && digest="$(curl -fsSL https://services.gradle.org/distributions/gradle-8.11.1-bin.zip.sha256)" \
    && printf '%s  %s\n' "$digest" /tmp/gradle.zip | sha256sum -c - \
    && unzip -q /tmp/gradle.zip -d /opt && rm /tmp/gradle.zip

RUN useradd --create-home --uid 10001 lab
WORKDIR /home/lab/source
COPY --chown=lab:lab . .
USER lab
RUN gradle --no-daemon --max-workers=2 -PdishaBrokerOnly=true :app:assembleDebug :app:testDebugUnitTest \
    && bash railway/verify-apk.sh app/build/outputs/apk/debug/app-debug.apk
CMD ["bash", "railway/runtime.sh"]
