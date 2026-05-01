package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/agent/adapters/polvointel"
	agapp "github.com/open-polvo/open-polvo/internal/agent/application"
	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	convsqlite "github.com/open-polvo/open-polvo/internal/conversations/adapters/sqlite"
	convapp "github.com/open-polvo/open-polvo/internal/conversations/application"
	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	contactssqlite "github.com/open-polvo/open-polvo/internal/contacts/adapters/sqlite"
	contactsapp "github.com/open-polvo/open-polvo/internal/contacts/application"
	bcryptadapter "github.com/open-polvo/open-polvo/internal/identity/adapters/bcrypt"
	jwtissuer "github.com/open-polvo/open-polvo/internal/identity/adapters/jwtissuer"
	idsqlite "github.com/open-polvo/open-polvo/internal/identity/adapters/sqlite"
	idapp "github.com/open-polvo/open-polvo/internal/identity/application"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
	platformdb "github.com/open-polvo/open-polvo/internal/platform/db"
	platformmigrate "github.com/open-polvo/open-polvo/internal/platform/migrate"
	mailsqlite "github.com/open-polvo/open-polvo/internal/mail/adapters/sqlite"
	mailapp "github.com/open-polvo/open-polvo/internal/mail/application"
	metasqlite "github.com/open-polvo/open-polvo/internal/meta/adapters/sqlite"
	metaapp "github.com/open-polvo/open-polvo/internal/meta/application"
	"github.com/open-polvo/open-polvo/internal/meta/metaapi"
	sqsqlite "github.com/open-polvo/open-polvo/internal/schedulequeue/adapters/sqlite"
	sqapp "github.com/open-polvo/open-polvo/internal/schedulequeue/application"
	sqports "github.com/open-polvo/open-polvo/internal/schedulequeue/ports"
	socialsqlite "github.com/open-polvo/open-polvo/internal/social/adapters/sqlite"
	socialapp "github.com/open-polvo/open-polvo/internal/social/application"
	"github.com/open-polvo/open-polvo/internal/social/scheduler"
	financesqlite "github.com/open-polvo/open-polvo/internal/finance/adapters/sqlite"
	financeapp "github.com/open-polvo/open-polvo/internal/finance/application"
	llmapp "github.com/open-polvo/open-polvo/internal/llmprofiles/application"
	llmstore "github.com/open-polvo/open-polvo/internal/llmprofiles/adapters/sqliterepo"
	tasklistssqlite "github.com/open-polvo/open-polvo/internal/tasklists/adapters/sqlite"
	tasklistsintel "github.com/open-polvo/open-polvo/internal/tasklists/adapters/polvointel"
	taskapp "github.com/open-polvo/open-polvo/internal/tasklists/application"
	tasklistsports "github.com/open-polvo/open-polvo/internal/tasklists/ports"
	"github.com/open-polvo/open-polvo/internal/schedule"
	httptransport "github.com/open-polvo/open-polvo/internal/transport/http"
	wfsqlite "github.com/open-polvo/open-polvo/internal/workflows/adapters/sqlite"
	wfapp "github.com/open-polvo/open-polvo/internal/workflows/application"
	wfports "github.com/open-polvo/open-polvo/internal/workflows/ports"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	cfg, err := platformcfg.Load()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}

	db, err := platformdb.Open(cfg)
	if err != nil {
		slog.Error("db open", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	if cfg.RunMigrations {
		migDir, err := platformmigrate.ResolveMigrationsDir(cfg.MigrationsPath)
		if err != nil {
			slog.Error("migrations path", "err", err)
			os.Exit(1)
		}
		slog.Info("running database migrations", "dir", migDir)
		if err := platformmigrate.Apply(db, migDir); err != nil {
			slog.Error("migrations", "err", err)
			os.Exit(1)
		}
		slog.Info("database migrations applied")
	}

	userRepo := idsqlite.UserRepository{DB: db}
	hasher := bcryptadapter.Hasher{}

	if cfg.BootstrapDefaultAdmin {
		if strings.TrimSpace(cfg.DefaultAdminPassword) == "" {
			slog.Error("BOOTSTRAP_DEFAULT_ADMIN=true exige DEFAULT_ADMIN_PASSWORD no ambiente (defina em .env; não commite valores reais)")
			os.Exit(1)
		}
		boot := idapp.DefaultAdminBootstrap{Users: userRepo, Hasher: hasher}
		created, err := boot.Ensure(context.Background(), cfg.DefaultAdminEmail, cfg.DefaultAdminPassword)
		if err != nil {
			slog.Error("bootstrap default admin", "err", err)
			os.Exit(1)
		}
		if created {
			slog.Warn("utilizador admin por defeito criado; altere DEFAULT_ADMIN_PASSWORD em produção",
				"email", cfg.DefaultAdminEmail)
		}
	}

	issuer := jwtissuer.Issuer{
		Secret: []byte(cfg.JWTSecret),
		Issuer: cfg.JWTIssuer,
		TTL:    cfg.JWTAccessTTL,
	}

	loginUC := &idapp.Login{
		Users:  userRepo,
		Hasher: hasher,
		Tokens: issuer,
	}
	registerUC := &idapp.Register{
		Users:  userRepo,
		Hasher: hasher,
		Tokens: issuer,
	}

	intel := polvointel.New(
		cfg.PolvoIntelligenceBaseURL,
		cfg.PolvoIntelligenceInternalKey,
		cfg.AgentLLMTimeout,
	)
	var chatOrch agentports.ChatOrchestrator
	var chatStream agentports.ChatStreamer
	if intel != nil {
		chatOrch = intel
		chatStream = intel
	} else {
		slog.Warn("Open Polvo Intelligence not configured (POLVO_INTELLIGENCE_BASE_URL + POLVO_INTELLIGENCE_INTERNAL_KEY)")
	}

	llmRepo := &llmstore.Repository{DB: db, Cfg: cfg}

	statusUC := &agapp.CheckAgentStatus{
		Client: intel,
		LocalCaps: func(ctx context.Context) (bool, bool) {
			o, _ := llmRepo.HasConfiguredProvider(ctx, "openai")
			g, _ := llmRepo.HasConfiguredProvider(ctx, "google")
			return o, g
		},
	}
	localThreadUC := agapp.CreateLocalThread{}

	authH := &httptransport.AuthHandlers{
		Login:         loginUC,
		Register:      registerUC,
		AllowRegister: cfg.AuthAllowRegister,
		Users:         userRepo,
		Parser:        issuer,
	}
	agentH := &httptransport.AgentHandlers{
		Status:       statusUC,
		CreateThread: &localThreadUC,
	}

	convRepo := convsqlite.ConversationRepository{DB: db}
	msgRepo := convsqlite.MessageRepository{DB: db}
	agentMemRepo := convsqlite.AgentMemoryRepository{DB: db}
	llmResolver := &llmapp.Resolver{Repo: llmRepo}
	llmHTTP := &httptransport.LLMHandlers{Repo: llmRepo}
	createConvUC := &convapp.CreateConversation{
		Conversations: convRepo,
	}
	smtpRepo := &mailsqlite.SMTPSettingsRepository{DB: db}
	smtpLoader := &mailapp.SMTPContextLoader{Repo: smtpRepo}
	metaRepo := &metasqlite.MetaSettingsRepository{DB: db}
	metaClient := metaapi.New()
	metaContextLoader := &metaapp.MetaContextLoader{Repo: metaRepo}
	contactRepo := &contactssqlite.ContactRepository{DB: db}
	contactsReply := &contactsapp.ContactsReplyLoader{Repo: contactRepo}
	getContactUC := &contactsapp.GetContact{Repo: contactRepo}
	taskListRepo := tasklistssqlite.NewTaskListRepository(db)
	taskItemRepo := tasklistssqlite.NewTaskItemRepository(db)
	taskListsReplyLoader := &taskapp.TaskListsReplyLoader{Lists: taskListRepo, Items: taskItemRepo}
	financeStore := financesqlite.NewStore(db)
	financeReplyLoader := &financeapp.FinanceReplyLoader{
		Categories:    financeStore,
		Transactions:  financeStore,
		Subscriptions: financeStore,
	}
	sendMsgUC := &convapp.SendMessage{
		Conversations: convRepo,
		Messages:      msgRepo,
		Agent:         chatOrch,
		LLM:           llmResolver,
		AgentMemory:   agentMemRepo,
		SMTPForReply:  smtpLoader.ForReply,
		ContactsForReply: func(ctx context.Context, userID uuid.UUID) []agentports.ContactBrief {
			return contactsReply.ForReply(ctx, userID)
		},
		TaskListsForReply: func(ctx context.Context, userID uuid.UUID) []agentports.TaskListBrief {
			return taskListsReplyLoader.ForReply(ctx, userID)
		},
		FinanceForReply: func(ctx context.Context, userID uuid.UUID) *agentports.FinanceContext {
			return financeReplyLoader.ForReply(ctx, userID)
		},
		MetaForReply: func(ctx context.Context, userID uuid.UUID) *agentports.MetaContext {
			return metaContextLoader.ForReply(ctx, userID)
		},
	}
	sendMailUC := &mailapp.SendUserEmail{Repo: smtpRepo, Cfg: cfg}
	mailHandlers := &httptransport.MailHandlers{
		GetSMTP:    &mailapp.GetMySMTP{Repo: smtpRepo},
		PutSMTP:    &mailapp.PutMySMTP{Repo: smtpRepo, Cfg: cfg},
		Send:       sendMailUC,
		TestSMTP:   &mailapp.TestSMTPConnection{Repo: smtpRepo, Cfg: cfg},
		GetContact: getContactUC,
	}
	contactHandlers := &httptransport.ContactHandlers{
		List:      &contactsapp.ListContacts{Repo: contactRepo},
		Create:    &contactsapp.CreateContact{Repo: contactRepo},
		Get:       getContactUC,
		Update:    &contactsapp.UpdateContact{Repo: contactRepo},
		DeleteOne: &contactsapp.DeleteContact{Repo: contactRepo},
	}
	var wfHandlers *httptransport.WorkflowHandlers
	wfRepo := wfsqlite.WorkflowRepository{DB: db}
	runRepo := wfsqlite.RunRepository{DB: db}
	var wfLLM wfports.IntelligenceService
	if intel != nil {
		wfLLM = intel
	}
	createWF := &wfapp.CreateWorkflow{Workflows: wfRepo}
	postMetaUC := &metaapp.PostMetaContent{Repo: metaRepo, Cfg: cfg, Client: metaClient}
	sendMetaUC := &metaapp.SendMetaMessage{Repo: metaRepo, Cfg: cfg, Client: metaClient}
	runWfUC := &wfapp.RunWorkflow{
		Workflows:    wfRepo,
		Runs:         runRepo,
		LLM:          wfLLM,
		LLMResolve:   llmResolver,
		DefaultModel: domain.ModelOpenAI,
		RunnerCfg:    wfapp.DefaultRunnerConfig(),
		SendEmail:    sendMailUC,
		GetContact:   getContactUC,
		PostMeta:     postMetaUC,
		SendWhatsApp: sendMetaUC,
	}
	wfHandlers = &httptransport.WorkflowHandlers{
		Create: createWF,
		Update: &wfapp.UpdateWorkflow{Workflows: wfRepo},
		Get:    &wfapp.GetWorkflow{Workflows: wfRepo},
		List:   &wfapp.ListWorkflows{Workflows: wfRepo},
		Delete: &wfapp.DeleteWorkflow{Workflows: wfRepo},
		Pin:    &wfapp.PinWorkflow{Workflows: wfRepo},
		Run:    runWfUC,
		Generate: &wfapp.GenerateWorkflow{LLM: wfLLM},
		SaveGenerated: &wfapp.SaveGeneratedWorkflow{
			Create: createWF,
		},
		ListRuns:   &wfapp.ListWorkflowRuns{Runs: runRepo},
		LLMResolve: llmResolver,
	}

	var taskExecutor tasklistsports.TaskExecutor
	if tex := tasklistsintel.NewTaskExecutorClient(cfg.PolvoIntelligenceBaseURL, cfg.PolvoIntelligenceInternalKey, cfg.AgentLLMTimeout); tex != nil {
		taskExecutor = tex
	}
	createTL := &taskapp.CreateTaskList{Lists: taskListRepo, Items: taskItemRepo}
	deleteTL := &taskapp.DeleteTaskList{Lists: taskListRepo}
	runTL := &taskapp.RunTaskList{
		Lists:        taskListRepo,
		Items:        taskItemRepo,
		Executor:     taskExecutor,
		DefaultModel: string(domain.ModelOpenAI),
	}
	patchTitleTL := &taskapp.PatchTaskListTitle{Lists: taskListRepo}
	appendTL := &taskapp.AppendTaskItems{Lists: taskListRepo, Items: taskItemRepo}
	patchItemTL := &taskapp.PatchTaskItem{Lists: taskListRepo, Items: taskItemRepo}
	deleteItemTL := &taskapp.DeleteTaskItem{Lists: taskListRepo, Items: taskItemRepo}
	batchTL := &taskapp.ApplyTaskListBatch{
		PatchListTitle: patchTitleTL,
		AppendItems:    appendTL,
		PatchItem:      patchItemTL,
		DeleteItem:     deleteItemTL,
		CreateList:     createTL,
		DeleteList:     deleteTL,
		RunList:        runTL,
	}
	taskHandlers := &httptransport.TaskListHandlers{
		Create:     createTL,
		Get:        &taskapp.GetTaskList{Lists: taskListRepo, Items: taskItemRepo},
		List:       &taskapp.ListTaskLists{Lists: taskListRepo},
		Delete:     deleteTL,
		Run:        runTL,
		PatchTitle: patchTitleTL,
		Append:     appendTL,
		PatchItem:  patchItemTL,
		DeleteItem: deleteItemTL,
		Batch:      batchTL,
	}

	streamMsgUC := &convapp.StreamMessage{
		Conversations: convRepo,
		Messages:      msgRepo,
		Streamer:      chatStream,
		LLM:           llmResolver,
		AgentMemory:   agentMemRepo,
		SMTPForReply:  smtpLoader.ForReply,
		ContactsForReply: func(ctx context.Context, userID uuid.UUID) []agentports.ContactBrief {
			return contactsReply.ForReply(ctx, userID)
		},
		TaskListsForReply: func(ctx context.Context, userID uuid.UUID) []agentports.TaskListBrief {
			return taskListsReplyLoader.ForReply(ctx, userID)
		},
		FinanceForReply: func(ctx context.Context, userID uuid.UUID) *agentports.FinanceContext {
			return financeReplyLoader.ForReply(ctx, userID)
		},
		MetaForReply: func(ctx context.Context, userID uuid.UUID) *agentports.MetaContext {
			return metaContextLoader.ForReply(ctx, userID)
		},
	}
	convHandlers := &httptransport.ConversationHandlers{
		CreateConversation: createConvUC,
		ListConversations: &convapp.ListConversations{
			Conversations: convRepo,
		},
		GetConversationUC: &convapp.GetConversation{Conversations: convRepo},
		ListMessages: &convapp.ListMessages{
			Conversations: convRepo,
			Messages:      msgRepo,
		},
		SendMessage:        sendMsgUC,
		StreamMsg:          streamMsgUC,
		DeleteConversation: &convapp.DeleteConversation{Conversations: convRepo},
		PinConversation:    &convapp.PinConversation{Conversations: convRepo},
		RenameConversation: &convapp.RenameConversation{Conversations: convRepo},
		AgentMemoryRepo:    agentMemRepo,
	}

	readyCheck := func(ctx context.Context) error {
		if err := db.PingContext(ctx); err != nil {
			return err
		}
		return nil
	}

	audioH := &httptransport.AudioHandlers{
		OpenAIAPIKey:          cfg.OpenAIAPIKey,
		GoogleAPIKey:          cfg.GoogleAPIKey,
		OpenAITranscribeModel: cfg.OpenAITranscribeModel,
		GeminiTranscribeModel: cfg.GeminiTranscribeModel,
	}

	socialConfigRepo := &socialsqlite.AutomationConfigRepository{DB: db}
	socialPostRepo := &socialsqlite.SocialPostRepository{DB: db}
	socialGenerator := &socialapp.GenerateAndStore{
		Posts:           socialPostRepo,
		IntelligenceURL: cfg.PolvoIntelligenceBaseURL,
		IntelligenceKey: cfg.PolvoIntelligenceInternalKey,
		HTTPTimeout:     cfg.AgentLLMTimeout,
	}
	socialPublisher := &socialapp.PublishPost{
		Posts:      socialPostRepo,
		MetaRepo:   metaRepo,
		MetaClient: metaClient,
		Cfg:        cfg,
	}
	socialApproval := &socialapp.SendApprovalWhatsApp{
		Posts:      socialPostRepo,
		MetaRepo:   metaRepo,
		MetaClient: metaClient,
		Cfg:        cfg,
	}
	socialReplyHandler := &socialapp.HandleWhatsAppReply{
		Posts:     socialPostRepo,
		Publisher: socialPublisher,
	}
	socialHandlers := &httptransport.SocialHandlers{
		GetConfig: &socialapp.GetSocialConfig{Repo: socialConfigRepo},
		PutConfig: &socialapp.PutSocialConfig{Repo: socialConfigRepo},
		Generate:  socialGenerator,
		Approval:  socialApproval,
		Publisher: socialPublisher,
		ListPosts: &socialapp.ListSocialPosts{Posts: socialPostRepo},
	}
	metaHandlers := &httptransport.MetaHandlers{
		GetMeta:             &metaapp.GetMyMeta{Repo: metaRepo},
		PutMeta:             &metaapp.PutMyMeta{Repo: metaRepo, Cfg: cfg},
		TestMeta:            &metaapp.TestMetaConnection{Repo: metaRepo, Cfg: cfg, Client: metaClient},
		PostContent:         postMetaUC,
		SendMessage:         sendMetaUC,
		WebhookVerifyToken:  cfg.MetaWebhookVerifyToken,
		AppSecretForWebhook:  cfg.MetaCredentialsKey,
		SocialReplyHandler:   socialReplyHandler,
		SocialConfigRepo:     socialConfigRepo,
	}
	financeHandlers := &httptransport.FinanceHandlers{
		Repo:      financeStore,
		TaskItems: taskItemRepo,
	}

	handler := httptransport.NewRouter(httptransport.Deps{
		Config:        cfg,
		Auth:          authH,
		Agent:         agentH,
		LLM:           llmHTTP,
		Conversations: convHandlers,
		Workflows:     wfHandlers,
		TaskLists:     taskHandlers,
		Mail:          mailHandlers,
		Contacts:      contactHandlers,
		Finance:       financeHandlers,
		Meta:          metaHandlers,
		Social:        socialHandlers,
		Schedule:      nil,
		Audio:         audioH,
		TokenParser:   issuer,
		ReadyCheck:    readyCheck,
	})

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server", "err", err)
			os.Exit(1)
		}
	}()

	schedCtx, schedCancel := context.WithCancel(context.Background())

	// Fila persistida para execuções agendadas (tasks + workflows).
	scheduleQueueRepo := sqsqlite.Repository{DB: db}
	queueEnabled := scheduleQueueEnabled()
	var queueWorker *sqapp.Worker
	if queueEnabled {
		workers := 2
		if s := strings.TrimSpace(os.Getenv("SCHED_QUEUE_WORKERS")); s != "" {
			if n, err := strconv.Atoi(s); err == nil && n >= 1 && n <= 16 {
				workers = n
			}
		}
		poll := 2 * time.Second
		if s := strings.TrimSpace(os.Getenv("SCHED_QUEUE_POLL_INTERVAL")); s != "" {
			if d, err := time.ParseDuration(s); err == nil && d >= 200*time.Millisecond {
				poll = d
			}
		}
		lockTTL := 10 * time.Minute
		if s := strings.TrimSpace(os.Getenv("SCHED_QUEUE_LOCK_TTL")); s != "" {
			if d, err := time.ParseDuration(s); err == nil && d >= time.Minute {
				lockTTL = d
			}
		}
		queueWorker = &sqapp.Worker{
			Queue:          &scheduleQueueRepo,
			ScheduledTasks: nil, // ligado abaixo quando schedRunner for criado
			WorkflowsRun:   runWfUC,
			WorkflowsRepo:  &wfRepo,
			Workers:        workers,
			PollInterval:   poll,
			LockTTL:        lockTTL,
			Log:            slog.Default(),
		}
		// Start() só depois de ligar ScheduledTasks ao runner (evita itens task na fila sem executor).
	}
	if workflowSchedulerEnabled() {
		interval := 45 * time.Second
		if s := strings.TrimSpace(os.Getenv("WORKFLOW_SCHEDULER_INTERVAL")); s != "" {
			if d, err := time.ParseDuration(s); err == nil && d >= 10*time.Second {
				interval = d
			}
		}
		var q sqports.Repository
		if queueEnabled {
			q = &scheduleQueueRepo
		}
		go wfapp.StartWorkflowScheduler(schedCtx, interval, &wfRepo, runWfUC, q, slog.Default())
	}
	if socialSchedulerEnabled() {
		interval := 15 * time.Minute
		if s := strings.TrimSpace(os.Getenv("SOCIAL_SCHEDULER_INTERVAL")); s != "" {
			if d, err := time.ParseDuration(s); err == nil && d >= time.Minute {
				interval = d
			}
		}
		socialRunner := &scheduler.Runner{
			Configs:       socialConfigRepo,
			Generator:     socialGenerator,
			Approval:      socialApproval,
			ModelProvider: "openai",
			Log:           slog.Default(),
		}
		go socialRunner.Start(schedCtx, interval)
	}
	if queueEnabled && queueWorker != nil {
		queueWorker.Start(schedCtx)
	}
	if digestSchedulerEnabled() {
		interval := time.Hour
		if s := strings.TrimSpace(os.Getenv("DIGEST_SCHEDULER_INTERVAL")); s != "" {
			if d, err := time.ParseDuration(s); err == nil && d >= time.Minute {
				interval = d
			}
		}
		schedule.StartFinanceJobs(schedCtx, interval, financeStore, sendMailUC, userRepo, taskItemRepo, slog.Default())
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	schedCancel()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown", "err", err)
	}
}

func workflowSchedulerEnabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("WORKFLOW_SCHEDULER_ENABLED")))
	if v == "" {
		return true
	}
	return v == "1" || v == "true" || v == "yes"
}

func socialSchedulerEnabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("SOCIAL_SCHEDULER_ENABLED")))
	if v == "" {
		return true
	}
	return v == "1" || v == "true" || v == "yes"
}

func scheduleQueueEnabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("SCHED_QUEUE_ENABLED")))
	if v == "" {
		return true
	}
	return v == "1" || v == "true" || v == "yes"
}

func digestSchedulerEnabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("DIGEST_SCHEDULER_ENABLED")))
	return v == "1" || v == "true" || v == "yes"
}
