import path from "path"
import { app, remote } from "electron"
import { computed, observable, reaction, toJS } from "mobx";
import Config from "conf"
import semver from "semver"
import migrations from "../migrations/user-store"
import Singleton from "./utils/singleton";
import { getAppVersion } from "./utils/app-version";
import { tracker } from "./tracker";
import isEqual from "lodash/isEqual"

export interface UserStoreModel {
  lastSeenAppVersion: string;
  seenContexts: string[];
  preferences: UserPreferences;
}

export interface UserPreferences {
  httpsProxy?: string;
  colorTheme?: string | "dark";
  allowUntrustedCAs?: boolean;
  allowTelemetry?: boolean;
  downloadMirror?: string | "default";
}

export class UserStore extends Singleton {
  private storeConfig: Config<UserStoreModel>;

  @observable isReady = false;
  @observable lastSeenAppVersion = "0.0.0"
  @observable seenContexts = observable.set();

  @observable preferences: UserPreferences = {
    allowTelemetry: true,
    colorTheme: "dark",
    downloadMirror: "default",
  };

  get name() {
    return path.basename(this.storeConfig.path);
  }

  @computed get hasNewAppVersion() {
    return semver.gt(getAppVersion(), this.lastSeenAppVersion);
  }

  private constructor() {
    super();
    this.init();
  }

  async init() {
    /*await*/ this.load();
    this.bindEvents();
    this.isReady = true;
  }

  saveLastSeenAppVersion() {
    this.lastSeenAppVersion = getAppVersion();
  }

  // todo: use "conf" as pseudo-async for more future-proof usages
  protected async load() {
    this.storeConfig = new Config<UserStoreModel>({
      configName: "lens-user-store",
      migrations: migrations,
      cwd: (app || remote.app).getPath("userData"),
      watch: true, // enable onDidChange()-callback
    });
    const data = this.storeConfig.store;
    console.info(`[STORE]: [LOADED] ${this.storeConfig.path}`, data);
    this.fromStore(data);
  }

  protected bindEvents() {
    // refresh from file-system updates
    this.storeConfig.onDidAnyChange((data, oldValue) => {
      if (!isEqual(this.toJSON(), data)) {
        console.info(`[STORE]: [UPDATE] ${this.name} from file-system`, { data, oldValue });
        this.fromStore(data);
      }
    });

    // refresh config file from runtime
    reaction(() => this.toJSON(), model => {
      if (!isEqual(this.storeConfig.store, model)) {
        console.info(`[STORE]: [UPDATE] ${this.name} to file-system from runtime model`, model);
        this.storeConfig.store = model; // fixme: actual save to fs won't happen
      }
    });

    // track telemetry availability
    reaction(() => this.preferences.allowTelemetry, allowed => {
      tracker.event("telemetry", allowed ? "enabled" : "disabled");
    });
  }

  // todo: maybe use "serializr"
  protected fromStore(data: Partial<UserStoreModel> = {}) {
    const { lastSeenAppVersion, seenContexts, preferences } = data
    if (lastSeenAppVersion) {
      this.lastSeenAppVersion = lastSeenAppVersion;
    }
    if (seenContexts) {
      this.seenContexts = observable.set(seenContexts)
    }
    if (preferences) {
      Object.assign(this.preferences, preferences);
    }
  }

  protected toJSON(): UserStoreModel {
    return toJS({
      lastSeenAppVersion: this.lastSeenAppVersion,
      seenContexts: Array.from(this.seenContexts),
      preferences: this.preferences,
    })
  }
}

export const userStore: UserStore = UserStore.getInstance();
